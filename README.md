# RUBI Human Preference Path

RUBI 이족 로봇의 경로 선호를 수집하는 **독립 브라우저 WASM 앱**입니다. 이 저장소 루트에서 실행합니다. 기존 `RUBI_Nav_simulation_package`의 ROS/Gazebo 패키지는 실행에 필요하지 않습니다.

## 현재 상태

- 독립 앱, 경로 비교 UI, MuJoCo WASM 및 ONNX Runtime Web 실행기, 자동 모델 로딩, 응답 API 코드가 있습니다.
- `public/models/rubi/rubi.xml`은 전달받은 MJCF의 외부 world include를 제거한 웹용 모델입니다. 단차 world는 앱에서 생성합니다.
- 전달받은 terrain 정책의 텐서 계약과 SHA-256은 `bundle.json`에 기록했습니다. **정책 바이너리 두 개와 STL 9개는 아직 추가해야 합니다.**
- GitHub Actions에서 단위 테스트와 production build, Chromium 화면 및 합성 ONNX/WASM 실행 테스트가 통과했습니다. 이는 실제 RUBI 보행 검증이 아닙니다.
- `public/study.json`은 `draft`입니다. 실제 보행과 조사 조건을 검증하기 전에는 본 조사 자료를 수집하지 마세요.
- 최초 Pages 설정 및 외부 응답 API 배포는 별도 작업입니다. 빌드 성공과 공개 웹 배포 성공을 구분하세요.

## 빠른 실행

Node.js 24를 사용합니다. `.nvmrc`에도 24를 기록했습니다.

```bash
git clone https://github.com/Kimgyoomin/RUBI_Human_Preference_Path.git
cd RUBI_Human_Preference_Path
npm ci
npm test
npm run dev
```

브라우저에서 `http://127.0.0.1:5173`을 엽니다. **`cd web`을 하지 않습니다.** 파일이 부족해도 world와 UI는 열리며 누락 목록을 표시합니다. 모델 없이 걷는 가짜 RUBI나 대체 정책을 사용하지 않습니다.

## 모델 파일을 넣는 위치

```text
public/models/rubi/
├── bundle.json          # 이미 있음: 필요한 파일과 정책 fingerprint
├── rubi.xml             # 이미 있음
├── encoder.onnx         # 추가 필요: [330] -> [32]
├── policy.onnx          # 추가 필요: [65] -> [6]
└── meshes/
    ├── BODY.STL
    ├── L_HIP.STL
    ├── L_THIGH.STL
    ├── L_CALF.STL
    ├── L_TIP.STL
    ├── R_HIP.STL
    ├── R_THIGH.STL
    ├── R_CALF.STL
    └── R_TIP.STL
```

GitHub 웹에서 해당 폴더의 **Add file → Upload files**를 사용하거나, 로컬 clone에 파일을 복사한 뒤 commit/push 합니다. ZIP 파일 자체가 아니라 압축을 푼 파일을 위 위치에 넣으세요. 파일명 대소문자를 유지하세요.

`.gitignore`는 이 배포 경로의 encoder/policy 및 STL만 예외로 허용합니다. 그 외 연구용 모델과 `private_assets/`는 Git에서 제외합니다.

```bash
# 파일 유무, 해시, XML의 참조와 기본 계약 검사. 보행 성공 검사는 아님.
python3 tools/check_assets.py --require-complete

# 메시를 검토한 후 전체 파일이 준비되었을 때만 fingerprint 기록
python3 tools/check_assets.py --record-mesh-hashes --require-complete
```

`encoder.onnx` SHA-256:
`8d04fa39832111a7c52dc012cc919afb387e17301799a863830c4fa83ab9d1ed`

`policy.onnx` SHA-256:
`bb7c45952e7471975c024127f8c8814f997ef1194e56f6c271f3834343939732`

이 조합은 `rubi_gazebo_terrain_lidar.launch.py`의 terrain 실행기를 대상으로 합니다. Legacy의 320→7 모델이나 RUBI-W의 340→3 / 40→8 모델을 사용하지 않습니다. 기존 canonical manifest의 300→3 / 36→6도 다른 계약입니다.

## 브라우저 실행 흐름

```text
study.json → models/rubi/bundle.json
    → XML / STL / ONNX 자동 다운로드 및 hash 검사
    → MuJoCo WASM + ONNX Runtime Web
    → 고정 dt로 두 경로 보행 계산
    → simulation time 기준 1× 재생
    → A/B/판단 어려움 응답
```

`public/study.json`의 `bundleBaseUrl`은 `./models/rubi/`입니다. 배포 파일이 완성되면 방문자가 직접 파일을 선택할 필요가 없습니다. 연구자 화면의 폴더/파일 선택도 유지하여 배포 전 로컬 파일로 점검할 수 있습니다.

자동 로더는 파일 누락, HTML fallback, 잘못된 경로 및 SHA-256 불일치를 보고하고 실행을 차단합니다. ONNX 실행기는 `float32 mlp_input / mlp_output`, 정확한 1차원 shape와 유한 출력을 검사합니다.

물리 `dt=0.002 s`, 정책 `dt=0.01 s`입니다. 벽시계 계산시간 `computeMs`와 시뮬레이션 주행시간 `duration`을 따로 기록합니다. 고정 dt만으로 서로 다른 브라우저/기기에서 완전히 동일한 동역학 결과를 보장하지는 않습니다.

## 주요 코드

| 파일 | 역할 |
| --- | --- |
| `src/main.ts` | 모델 연결, 두 경로 생성·재생, 응답 UI |
| `src/core/terrain-controller.ts` | terrain 관측/history/action/PD 계산 |
| `src/core/scenario.ts` | 단차·우회 경로 생성과 경로 추종 |
| `src/runtime/physics.ts` | MuJoCo 모델 검사, 시작 지지 해제, rollout |
| `src/runtime/onnx.ts` | 정책 텐서 계약 검사 및 WASM 추론 |
| `src/runtime/hosted-bundle.ts` | 배포 자산 자동 로딩 및 fingerprint 검사 |
| `src/runtime/viewer.ts` | 3D world와 로봇 표시 |
| `api/server.mjs` | 응답 저장, 중복 방지, 관리자 JSON/CSV export |
| `tools/check_assets.py` | 배포 전 파일 검사 |
| `tools/browser-smoke.mjs` | Chromium UI 및 합성 모델 runtime smoke test |

## GitHub Pages 배포

1. 저장소 **Settings → Pages → Build and deployment → Source: GitHub Actions**를 설정합니다.
2. **Actions → RUBI WASM Web → Run workflow**에서 `deploy`를 체크합니다.
3. `build`와 `deploy`의 성공을 각각 확인합니다. `deploy: skipped`는 공개 배포 완료가 아닙니다.

예정 주소: `https://kimgyoomin.github.io/RUBI_Human_Preference_Path/`

현재 GitHub 공식 안내상 Private 저장소의 Pages는 Pro/Team/Enterprise 등 지원 요금제가 필요합니다. Pages가 비활성 또는 현재 연결에서 사용 불가능하면 워크플로는 빌드만 하고 배포를 건너뜁니다. 저장소를 자동으로 Public으로 바꾸지 않습니다.

- https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages
- https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site

웹에서 제공하는 XML/STL/ONNX는 참가자 기기로 전달되어 다운로드할 수 있습니다. 소스 저장소의 Private 설정은 배포 자산을 숨기지 않습니다.

## 응답 저장과 조사 전환

GitHub Pages는 정적 웹 호스팅이므로 SQLite 응답 서버를 실행하지 않습니다. `api/server.mjs`는 구현되어 있지만, 외부 서버에 배포하고 HTTPS API 주소를 연결해야 중앙 수집이 됩니다.

로컬 확인은 별도 터미널에서 `npm run api`를 실행한 뒤 연구자 화면의 응답 API 주소를 `http://127.0.0.1:8787/api`로 설정합니다. 서버의 연구 ID 및 draft/released 상태는 웹과 일치해야 합니다. 환경 변수는 API 소스와 `.env.example`을 참고하세요. 관리자 토큰을 프런트엔드에 넣지 마세요.

실제 RUBI 평지/단차/회전 완주 검증, 변인통제, 참가자 안내와 응답 API 준비 후에만 `status`를 `released`로 전환합니다. 현재 단차 경로는 플랫폼의 상승과 하강을 모두 포함하며, 우회거리 변화에 회전 특성도 함께 변합니다. 단일 상승 CoT와 직접 동일시하지 마세요.

## 검증 범위

[실행 확인 로그](https://github.com/Kimgyoomin/RUBI_Human_Preference_Path/actions/runs/35498168459)

확인: 단위 테스트, production build, Chromium 데스크톱/모바일 크기의 UI 렌더링, 실제 MuJoCo WASM의 간단한 모델 적분, 실제 ONNX Runtime WASM에서 **합성 zero-weight 모델**의 330→32 및 65→6 추론. `browser-diagnostics` artifact에 스크린샷과 결과 JSON을 저장합니다.

미확인: 실제 STL+RUBI 정책을 결합한 평지/단차 보행, Gazebo와 MuJoCo의 보행 동등성, 실제 휴대전화 성능, 외부 응답 API와 공개 Pages 서비스. 제어 산술 테스트나 합성 모델 추론 성공을 실제 RUBI 보행 성공으로 해석하지 않습니다.

코드 출처는 `docs/PROVENANCE.md`를 참고하세요.
