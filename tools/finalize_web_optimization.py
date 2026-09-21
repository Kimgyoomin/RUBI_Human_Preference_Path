from pathlib import Path
p=Path('src/main.ts');s=p.read_text()
old='viewer.attach(nextEngine);engine?.dispose();await networks?.dispose();bundle=candidate;'
new='viewer.attach(nextEngine);bundle=candidate;'
if old in s:
    assert s.count(old)==1
    p.write_text(s.replace(old,new))
else:
    assert new in s
p=Path('.gitignore');s=p.read_text()
for line in ['!public/models/rubi-web/encoder.onnx','!public/models/rubi-web/policy.onnx','!public/models/rubi-web/meshes/*.STL']:
    if line not in s:s+=line+'\n'
p.write_text(s)
print('IMPORT_OWNERSHIP_AND_DERIVATIVE_PATHS_READY')
