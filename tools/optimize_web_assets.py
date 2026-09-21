#!/usr/bin/env python3
"""Generate a separate, reduced visual bundle; never overwrite RUBI source assets.
Requires numpy==2.2.6 and fast-simplification==0.1.13. Run from repository root.
"""
from pathlib import Path
import argparse
import hashlib
import json
import shutil
import struct
import xml.etree.ElementTree as ET
import numpy as np
import fast_simplification

SOURCE = Path('public/models/rubi')
DEST = Path('public/models/rubi-web')
TARGETS = {'BODY': 60000, 'L_HIP': 20000, 'R_HIP': 20000,
           'L_THIGH': 25000, 'R_THIGH': 25000, 'L_CALF': 6000, 'R_CALF': 6000}
DTYPE = np.dtype([('normal', '<f4', (3,)), ('vertices', '<f4', (3, 3)), ('attribute', '<u2')])

def sha(data):
    return hashlib.sha256(data).hexdigest()

def read_stl(data):
    if len(data) < 84:
        raise ValueError('Truncated binary STL')
    count = struct.unpack_from('<I', data, 80)[0]
    if count < 1 or len(data) != 84 + count * 50:
        raise ValueError('STL face count and byte length do not match')
    triangles = np.frombuffer(data, DTYPE, count=count, offset=84)['vertices'].copy()
    if not np.isfinite(triangles).all():
        raise ValueError('Non-finite STL coordinates')
    return triangles

def write_stl(vertices, faces):
    triangles = np.asarray(vertices[faces], dtype=np.float32)
    if not np.isfinite(triangles).all() or len(triangles) == 0:
        raise ValueError('Invalid simplified geometry')
    out = np.zeros(len(triangles), DTYPE)
    out['vertices'] = triangles
    normals = np.cross(triangles[:, 1] - triangles[:, 0], triangles[:, 2] - triangles[:, 0])
    norms = np.linalg.norm(normals, axis=1)
    good = norms > 1e-15
    normals[good] /= norms[good, None]
    out['normal'] = normals
    return b'RUBI visual-only QEM derivative; source preserved'.ljust(80, b'\0') + struct.pack('<I', len(out)) + out.tobytes()

def generate():
    manifest = json.loads((SOURCE / 'bundle.json').read_text())
    original = {a['path']: (SOURCE / a['path']).read_bytes() for a in manifest['files']}
    for a in manifest['files']:
        if a.get('sha256') and sha(original[a['path']]) != a['sha256']:
            raise ValueError('Source fingerprint mismatch: ' + a['path'])
    root = ET.fromstring(original['rubi.xml'])
    compiler = root.find('compiler')
    if compiler is None or compiler.get('meshdir') != 'meshes':
        raise ValueError('Unexpected mesh directory; review model before generating')
    visual_default = root.find(".//default[@class='visualgeom']/geom")
    if visual_default is None or any(visual_default.get(k) != '0' for k in ['contype', 'conaffinity']):
        raise ValueError('visualgeom must be non-colliding')
    if compiler.get('inertiafromgeom', 'auto') == 'true':
        raise ValueError('Visual-only simplification requires explicit body inertias')
    parents = {c: p for p in root.iter() for c in p}
    mesh_assets = {e.get('name'): e for e in root.findall('./asset/mesh')}
    DEST.mkdir(parents=True, exist_ok=True)
    rows = []
    for name, target in TARGETS.items():
        mesh = mesh_assets[name]
        path = 'meshes/' + mesh.get('file')
        refs = [g for g in root.findall('.//worldbody//geom') if g.get('mesh') == name]
        if not refs:
            raise ValueError('Unreferenced visual mesh: ' + name)
        for g in refs:
            if g.get('type', 'mesh') != 'mesh' or g.get('class') != 'visualgeom':
                raise ValueError('Not a visual mesh: ' + name)
            if any(g.get(k, '0') != '0' for k in ['contype', 'conaffinity']):
                raise ValueError('Collision override on visual mesh: ' + name)
            if parents[g].find('inertial') is None:
                raise ValueError('Missing explicit body inertia: ' + name)
            if g.get('fluidshape') or g.get('fluidcoef'):
                raise ValueError('Visual geometry participates in fluid dynamics: ' + name)
        # Explicit contact pairs override collision masks. Refuse such a model.
        names = {g.get('name') for g in refs if g.get('name')}
        if any(e.get(k) in names for e in root.findall('./contact/pair') for k in ['geom1', 'geom2']):
            raise ValueError('Visual mesh referenced by contact pair: ' + name)
        triangles = read_stl(original[path])
        points, inverse = np.unique(triangles.reshape(-1, 3), axis=0, return_inverse=True)
        faces = inverse.reshape(-1, 3)
        vertices, reduced_faces = fast_simplification.simplify(points.astype(np.float64), faces, target_count=target, agg=5)
        result = write_stl(vertices, reduced_faces)
        reduced = read_stl(result)
        before_bounds = np.array([triangles.min(axis=(0, 1)), triangles.max(axis=(0, 1))])
        after_bounds = np.array([reduced.min(axis=(0, 1)), reduced.max(axis=(0, 1))])
        bound_delta = float(np.max(np.abs(before_bounds - after_bounds)))
        # This is an AABB guard, not a Hausdorff/surface-error guarantee.
        if bound_delta > 0.003 or len(reduced) > 180000:
            raise ValueError(f'{name}: visual bound/face budget exceeded: {bound_delta}, {len(reduced)}')
        target_path = DEST / path
        target_path.parent.mkdir(parents=True, exist_ok=True)
        target_path.write_bytes(result)
        rows.append({'mesh': name, 'originalBytes': len(original[path]), 'webBytes': len(result),
                     'originalFaces': len(triangles), 'webFaces': len(reduced),
                     'aabbMaxDeltaMeters': bound_delta, 'sourceSha256': sha(original[path]), 'webSha256': sha(result)})
    for path, data in original.items():
        if path.startswith('meshes/') and Path(path).stem in TARGETS:
            continue
        (DEST / path).parent.mkdir(parents=True, exist_ok=True)
        (DEST / path).write_bytes(data)
    # Identical XML and contact meshes; only seven visual STL byte streams differ.
    for path in ['rubi.xml', 'encoder.onnx', 'policy.onnx', 'meshes/L_TIP.STL', 'meshes/R_TIP.STL']:
        assert (DEST / path).read_bytes() == original[path], path
    web_manifest = dict(manifest)
    web_manifest['visualVariant'] = 'qem-web-v1'
    web_manifest['sourceBundleSha256'] = sha((SOURCE / 'bundle.json').read_bytes())
    web_manifest['files'] = [{'path': a['path'], 'sha256': sha((DEST / a['path']).read_bytes())} for a in manifest['files']]
    (DEST / 'bundle.json').write_text(json.dumps(web_manifest, indent=2) + '\n')
    old_bytes = sum(len(v) for k, v in original.items() if k.lower().endswith('.stl'))
    new_bytes = sum((DEST / k).stat().st_size for k in original if k.lower().endswith('.stl'))
    report = {'sourcePreserved': True, 'identicalXmlPolicyAndFootContacts': True,
              'originalMeshBytes': old_bytes, 'webMeshBytes': new_bytes,
              'reductionPercent': 100 * (1 - new_bytes / old_bytes), 'meshes': rows,
              'method': 'QEM fast-simplification 0.1.13; no scale/pose/inertia/contact edits',
              'limits': 'AABB comparison only; inspect silhouette before releasing a study.'}
    Path('docs').mkdir(exist_ok=True)
    Path('docs/web-assets-report.json').write_text(json.dumps(report, indent=2) + '\n')
    for path, data in original.items():
        assert (SOURCE / path).read_bytes() == data, 'Original was modified: ' + path
    print('WEB_ASSETS_REPORT ' + json.dumps(report), flush=True)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Write the derived rubi-web bundle (originals remain unchanged).')
    args = parser.parse_args()
    if not args.apply:
        parser.error('Use --apply to generate the separate web bundle.')
    generate()
