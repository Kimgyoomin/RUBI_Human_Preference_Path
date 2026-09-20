#!/usr/bin/env python3
"""Import the user's existing web app once; never modify the source repository.
Source: Kimgyoomin/RUBI_Nav_simulation_package
Pinned commit: 59b761712a4cd280d545cfd29b3509a988671fdf
After import, all application files live here and builds are independent.
"""
from pathlib import Path
import argparse
import json
import shutil

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path, old, new):
    text = path.read_text()
    if text.count(old) != 1:
        raise RuntimeError(f'Pinned source differs at {path}: expected one match')
    path.write_text(text.replace(old, new, 1))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    args = parser.parse_args()
    target = ROOT / 'web'
    if (target / 'package.json').exists():
        print('Standalone app already exists. No application files overwritten.')
        return
    source = args.source / 'web'
    if not (source / 'src/runtime/physics.ts').is_file():
        raise RuntimeError('Expected pinned browser application was not found')
    shutil.copytree(source, target, dirs_exist_ok=True)
    # The original rendering, policy implementation and golden tests are kept.
    # Do not redistribute bundled font binaries; use the platform font stack.
    replace_once(target / 'src/main.ts', "import '@fontsource-variable/noto-sans-kr';\n", "import { fetchHostedFiles } from './runtime/hosted-bundle.ts';\n")
    replace_once(target / 'vite.config.ts', "'/RUBI_Nav_simulation_package/'", "'/RUBI_Human_Preference_Path/'")
    main_path = target / 'src/main.ts'
    text = main_path.read_text().replace('rubi-hpp-participant', 'rubi-hpp-standalone-participant').replace('rubi-hpp-progress-', 'rubi-hpp-standalone-progress-').replace('rubi-hpp-responses', 'rubi-hpp-standalone-responses').replace('rubi-hpp-api', 'rubi-hpp-standalone-api')
    start = text.index("      const response=await fetch(new URL('rubi.xml',base));")
    end = text.index('      await importFiles(files);', start)
    text = text[:start] + "      status('배포 모델과 정책을 내려받고 있어요.');\n      const files=await fetchHostedFiles(base);\n" + text[end:]
    # Fixed time steps control simulation; inference latency must not change dt.
    # Wall-clock generation duration is recorded separately from playback duration.
    text = text.replace('const run=await engine!.rollout(', 'const computeStarted=performance.now();\n      const run=await engine!.rollout(')
    text = text.replace('rollouts[key]=run;refresh();', 'rollouts[key]={...run,computeMs:performance.now()-computeStarted};refresh();')
    main_path.write_text(text)
    replace_once(target / 'src/runtime/physics.ts', 'export type Rollout={id:string;', 'export type Rollout={computeMs?:number;id:string;')
    (target / '.gitignore').write_text('node_modules/\ndist/\n.env\n.env.local\ndata/\n*.sqlite*\n')
    (target / '.env.example').write_text('# Node.js 24 is used in CI.\n# GITHUB_PAGES=true selects /RUBI_Human_Preference_Path/\n# VITE_RESPONSE_API=https://your-response-server.example/api\n')
    config = json.loads((target / 'public/study.json').read_text())
    config['bundleBaseUrl'] = './rubi/'
    config['status'] = 'draft'
    config['responseApi'] = ''
    (target / 'public/study.json').write_text(json.dumps(config, ensure_ascii=False, indent=2) + '\n')
    (target / 'README.md').write_text('# Browser application\n\nSee the repository root README.md for setup, assets, tests and deployment.\n\nThis is an independent copy of the browser pilot from source commit 59b761712a4cd280d545cfd29b3509a988671fdf; ROS/Gazebo source is not a runtime dependency.\n\nThe original golden fixtures compare controller arithmetic, not equivalence between Gazebo and MuJoCo dynamics. Real locomotion still requires the complete robot bundle.\n')
    (ROOT / '.nvmrc').write_text('24\n')
    print('Standalone application imported. No writes to source repository.')


if __name__ == '__main__':
    main()
