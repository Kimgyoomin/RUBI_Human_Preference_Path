from pathlib import Path
p=Path('src/main.ts');s=p.read_text()
old='viewer.attach(nextEngine);engine?.dispose();await networks?.dispose();bundle=candidate;'
new='viewer.attach(nextEngine);viewer.robot.visible=true;bundle=candidate;'
if old in s:
    assert s.count(old)==1
    p.write_text(s.replace(old,new))
else:
    assert new in s
p=Path('.gitignore');s=p.read_text()
for line in ['!public/models/rubi-web/encoder.onnx','!public/models/rubi-web/policy.onnx','!public/models/rubi-web/meshes/*.STL']:
    if line not in s:s+=line+'\n'
p.write_text(s)
p=Path('src/runtime/physics.ts');s=p.read_text()
if "import { setEqualityActive }" not in s:
    s="import { setEqualityActive } from './equality-state.ts';\n"+s
old='if(this.support>=0) this.data.eq_active[this.support]=0;'
new='if(this.support>=0) setEqualityActive(this.mj,this.model,this.data,this.support,false);'
if old in s:s=s.replace(old,new)
else:assert new in s
p.write_text(s)
print('IMPORT_OWNERSHIP_DERIVATIVE_PATHS_AND_EQ_STATE_READY')
