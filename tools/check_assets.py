#!/usr/bin/env python3
"""Check deployment assets. This does NOT validate locomotion performance."""
from pathlib import Path
import argparse
import hashlib
import json
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--require-complete', action='store_true')
    parser.add_argument('--record-mesh-hashes', action='store_true', help='Explicitly record mesh fingerprints after reviewing assets')
    args = parser.parse_args()
    base = ROOT / 'public/models/rubi'
    manifest_path = base / 'bundle.json'
    manifest = json.loads(manifest_path.read_text())
    if manifest.get('schemaVersion') != 1 or manifest.get('profile') != 'gazebo-terrain-330-32-65-6':
        raise ValueError('Unexpected bundle profile')
    missing, errors, seen = [], [], set()
    for asset in manifest['files']:
        name = asset['path']
        path = (base / name).resolve()
        if name in seen or not path.is_relative_to(base.resolve()) or Path(name).is_absolute():
            raise ValueError(f'Unsafe or duplicate path: {name}')
        seen.add(name)
        if not path.is_file():
            missing.append(name)
            continue
        data = path.read_bytes()
        if not data or len(data) > 64 * 1024 * 1024:
            errors.append(f'{name}: file must be nonempty and <=64 MiB')
        digest = hashlib.sha256(data).hexdigest()
        if asset.get('sha256') and asset['sha256'] != digest:
            errors.append(f'{name}: SHA256 does not match approved bundle')
        if args.record_mesh_hashes and name.lower().endswith('.stl'):
            asset['sha256'] = digest
        print(f'PRESENT {name}: {len(data)} bytes; sha256={digest}')
    if not {'rubi.xml', 'encoder.onnx', 'policy.onnx'} <= seen:
        errors.append('Manifest must contain rubi.xml, encoder.onnx and policy.onnx')
    xml = base / 'rubi.xml'
    if xml.exists():
        text = xml.read_text()
        if '<!DOCTYPE' in text.upper() or '<!ENTITY' in text.upper():
            raise ValueError('XML external entities are not supported')
        robot = ET.fromstring(text)
        if robot.tag != 'mujoco' or robot.find('option').get('timestep') != '0.002':
            errors.append('Expected a MuJoCo robot with timestep=0.002')
        if len(robot.findall('./actuator/motor')) != 6:
            errors.append('Expected 6 torque motors')
        meshdir = robot.find('compiler').get('meshdir', '')
        for mesh in robot.findall('./asset/mesh'):
            ref = str(Path(meshdir) / mesh.get('file', ''))
            if ref not in seen:
                errors.append(f'XML mesh is absent from manifest: {ref}')
    study_path = ROOT / 'public/study.json'
    released = study_path.exists() and json.loads(study_path.read_text()).get('status') == 'released'
    for name in missing:
        print(f'MISSING {name}')
    for message in errors:
        print(f'ERROR {message}', file=sys.stderr)
    if errors or (missing and (args.require_complete or released)):
        return 1
    if args.record_mesh_hashes:
        if missing:
            print('Refusing to record an incomplete asset set.', file=sys.stderr)
            return 1
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print('ASSET FILE CHECK COMPLETE' if not missing else 'DRAFT ONLY: missing assets are listed above. Browser locomotion is not ready.')
    print('No simulation or walking-success test was performed by this script.')
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, AttributeError, ET.ParseError) as exc:
        print(f'Asset check failed: {exc}', file=sys.stderr)
        raise SystemExit(1)
