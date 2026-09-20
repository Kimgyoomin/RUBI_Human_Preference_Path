#!/usr/bin/env python3
"""Read ONNX I/O metadata without executing the graph (standard library only)."""
from pathlib import Path
import argparse, hashlib, json

def varint(buf,pos):
    value=0
    for shift in range(0,70,7):
        if pos>=len(buf):raise ValueError('Truncated protobuf varint')
        b=buf[pos];pos+=1;value|=(b&127)<<shift
        if not b&128:return value,pos
    raise ValueError('Invalid protobuf varint')

def fields(buf):
    pos=0
    while pos<len(buf):
        tag,pos=varint(buf,pos);num,wire=tag>>3,tag&7
        if num==0:raise ValueError('Invalid protobuf field number')
        if wire==0:value,pos=varint(buf,pos)
        elif wire in (1,5):
            size=8 if wire==1 else 4;end=pos+size
            if end>len(buf):raise ValueError('Truncated protobuf field')
            value=buf[pos:end];pos=end
        elif wire==2:
            size,pos=varint(buf,pos);end=pos+size
            if end>len(buf):raise ValueError('Truncated protobuf message')
            value=buf[pos:end];pos=end
        else:raise ValueError(f'Unsupported protobuf wire type {wire}')
        yield num,wire,value

def one(buf,num,default=None):
    return next((v for n,w,v in fields(buf) if n==num),default)

def describe_value(buf):
    name=one(buf,1,b'').decode('utf-8');tensor=one(one(buf,2,b''),1,b'');dims=[]
    for n,w,d in fields(one(tensor,2,b'')):
        if n==1:
            value=one(d,1);symbol=one(d,2)
            dims.append(value if value is not None else symbol.decode() if symbol else None)
    return {'name':name,'element_type':one(tensor,1),'shape':dims}

def inspect(path):
    data=Path(path).read_bytes();graph=one(data,7)
    if graph is None:raise ValueError('No ONNX graph found')
    return {'filename':Path(path).name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),
        'ir_version':one(data,1),'producer':one(data,2,b'').decode('utf-8'),
        'inputs':[describe_value(v) for n,w,v in fields(graph) if n==11],
        'outputs':[describe_value(v) for n,w,v in fields(graph) if n==12]}

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('files',nargs='+',type=Path);a=p.parse_args()
    try:print(json.dumps([inspect(f) for f in a.files],indent=2,ensure_ascii=False))
    except (OSError,ValueError,UnicodeError) as e:p.exit(1,f'Inspection failed: {e}\n')
