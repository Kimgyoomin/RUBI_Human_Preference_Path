#!/usr/bin/env python3
"""One-time consolidation of initial staging files into the standalone root app.
Does not access or modify any other repository. Idempotent after completion.
"""
from pathlib import Path
import hashlib
import json
import shutil

ROOT = Path(__file__).resolve().parents[1]
MARKER = ROOT / 'docs/STANDALONE_LAYOUT.md'


def main():
    if MARKER.exists():
        print('Root layout already consolidated; no changes.')
        return
    if not (ROOT / 'package.json').exists():
        raise RuntimeError('Standalone root app must exist before consolidation')
    copies = {
        'web/src/runtime/hosted-bundle.ts': 'src/runtime/hosted-bundle.ts',
        'web/tests/hosted-bundle.test.mjs': 'tests/hosted-bundle.test.mjs',
        'web/public/rubi/bundle.json': 'public/models/rubi/bundle.json',
    }
    for old, new in copies.items():
        source, target = ROOT / old, ROOT / new
        if not source.exists():
            raise RuntimeError(f'Missing initial staging file: {old}')
        if target.exists() and target.read_bytes() != source.read_bytes():
            raise RuntimeError(f'Refusing to overwrite independently edited {new}')
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
    manifest_path = ROOT / 'public/models/rubi/bundle.json'
    manifest = json.loads(manifest_path.read_text())
    xml_path = ROOT / 'public/models/rubi/rubi.xml'
    if not xml_path.exists():
        shutil.copyfile(ROOT / 'web/public/rubi/rubi.xml', xml_path)
    # Preserve the already committed root XML, including its formatting.
    for asset in manifest['files']:
        if asset['path'] == 'rubi.xml':
            asset['sha256'] = hashlib.sha256(xml_path.read_bytes()).hexdigest()
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    check = ROOT / 'tools/check_assets.py'
    check.write_text(check.read_text().replace("'web/public/rubi'", "'public/models/rubi'").replace("'web/public/study.json'", "'public/study.json'"))
    hosted = ROOT / 'src/runtime/hosted-bundle.ts'
    hosted.write_text(hosted.read_text().replace('web/public/rubi/', 'public/models/rubi/'))
    main_file = ROOT / 'src/main.ts'
    text = main_file.read_text()
    text = text.replace("import '@fontsource-variable/noto-sans-kr';", "import { fetchHostedFiles } from './runtime/hosted-bundle.ts';")
    start = text.index("      const response=await fetch(new URL('rubi.xml',base));")
    end = text.index('      await importFiles(files);', start)
    text = text[:start] + "      status('배포 모델과 정책을 내려받고 있어요.');\n      const files=await fetchHostedFiles(base);\n" + text[end:]
    text = text.replace('const run=await engine!.rollout(', 'const computeStarted=performance.now();\n      const run=await engine!.rollout(')
    text = text.replace('rollouts[key]=run;refresh();', 'rollouts[key]={...run,computeMs:performance.now()-computeStarted};refresh();')
    main_file.write_text(text)
    physics = ROOT / 'src/runtime/physics.ts'
    physics.write_text(physics.read_text().replace('export type Rollout={id:string;', 'export type Rollout={computeMs?:number;id:string;'))
    study_path = ROOT / 'public/study.json'
    study = json.loads(study_path.read_text())
    if study['status'] != 'draft':
        raise RuntimeError('Do not modify a released study automatically')
    study['bundleBaseUrl'] = './models/rubi/'
    study_path.write_text(json.dumps(study, ensure_ascii=False, indent=2) + '\n')
    (ROOT / '.nvmrc').write_text('24\n')
    # Remove only this setup's known staging files, never arbitrary web/ data.
    for name in [*copies, 'web/public/rubi/rubi.xml', 'tools/bootstrap_standalone.py']:
        path = ROOT / name
        if path.exists():
            path.unlink()
    staging = ROOT / 'web'
    if staging.exists():
        for directory in sorted((p for p in staging.rglob('*') if p.is_dir()), key=lambda p: len(p.parts), reverse=True):
            if not any(directory.iterdir()):
                directory.rmdir()
        if not any(staging.iterdir()):
            staging.rmdir()
    MARKER.parent.mkdir(exist_ok=True)
    MARKER.write_text('# Standalone layout\n\nApplication entry points are package.json and src/ at repository root. Models belong in public/models/rubi/, not web/.\n\nHosted models are downloaded by the browser, validated against bundle.json, then executed locally with fixed simulation time steps. computeMs records wall-clock computation time separately from simulation duration.\n\nThis consolidation did not modify RUBI_Nav_simulation_package. Original model parameters in the root MJCF were preserved.\n')
    print('Standalone root layout consolidated.')


if __name__ == '__main__':
    main()
