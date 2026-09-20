#!/usr/bin/env python3
"""Verify the hosted terrain bundle. Missing files are allowed only for draft builds."""
from pathlib import Path
import argparse, json, xml.etree.ElementTree as ET
from inspect_onnx import inspect
EXPECTED={
 'encoder.onnx':([330],[32],'8d04fa39832111a7c52dc012cc919afb387e17301799a863830c4fa83ab9d1ed'),
 'policy.onnx':([65],[6],'bb7c45952e7471975c024127f8c8814f997ef1194e56f6c271f3834343939732')}
MESHES=['BODY.STL','L_HIP.STL','L_THIGH.STL','L_CALF.STL','L_TIP.STL','R_HIP.STL','R_THIGH.STL','R_CALF.STL','R_TIP.STL']
def check(folder):
    folder=Path(folder);missing=[];models=[]
    for name in ['rubi.xml',*EXPECTED,*['meshes/'+x for x in MESHES]]:
        if not (folder/name).is_file():missing.append(name)
    for name,(inp,out,digest) in EXPECTED.items():
        if not (folder/name).is_file():continue
        info=inspect(folder/name)
        if info['inputs']!=[{'name':'mlp_input','element_type':1,'shape':inp}] or info['outputs']!=[{'name':'mlp_output','element_type':1,'shape':out}]:raise ValueError(f'{name}: wrong terrain tensor contract')
        if info['sha256']!=digest:raise ValueError(f'{name}: differs from supplied terrain weights; review before changing the contract')
        models.append(info)
    xml=folder/'rubi.xml'
    if xml.is_file():
        text=xml.read_text(encoding='utf-8')
        if '<!DOCTYPE' in text.upper() or '<!ENTITY' in text.upper():raise ValueError('XML entity declarations are not supported')
        root=ET.fromstring(text)
        if root.tag!='mujoco':raise ValueError('rubi.xml is not a MuJoCo MJCF model')
        option=root.find('option')
        if option is not None and float(option.get('timestep','0.002'))!=0.002:raise ValueError('Expected physics timestep 0.002')
        motors=root.findall('./actuator/motor')
        if len(motors)!=6:raise ValueError('Expected six direct motor actuators')
        if any(m.get('gear','1')!='1' for m in motors):raise ValueError('Expected motor gear 1')
    for name in MESHES:
        p=folder/'meshes'/name
        if p.is_file():
            header=p.read_bytes()[:100]
            if len(header)<84 or header.startswith(b'version https://git-lfs.github.com/spec/v1'):raise ValueError(f'{name}: missing mesh data or Git LFS pointer')
    return {'status':'ASSETS_MISSING' if missing else 'BUNDLE_METADATA_PASS','missing':missing,'models':models,'locomotion_validated':False}
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('folder',nargs='?',default='public/models/rubi');p.add_argument('--strict',action='store_true');a=p.parse_args()
    try:
        result=check(a.folder)
        config=Path('public/study.json');released=config.is_file() and json.loads(config.read_text()).get('status')=='released'
        print(json.dumps(result,indent=2))
        Path('artifacts').mkdir(exist_ok=True);Path('artifacts/asset-readiness.json').write_text(json.dumps(result,indent=2)+'\n')
        raise SystemExit(2 if result['missing'] and (a.strict or released) else 0)
    except (ValueError,OSError,UnicodeError,ET.ParseError) as e:p.exit(1,f'Asset validation failed: {e}\n')
