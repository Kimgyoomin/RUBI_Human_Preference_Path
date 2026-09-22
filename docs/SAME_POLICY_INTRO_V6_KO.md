# 동일 정책 소개 영상 + 정보가 명확한 두 선택지 (v6)

## 참가자 흐름

참여 동의 → 로봇/RUBI 사전 경험 → RUBI 보행 소개 → 문항별 A/B 관찰 → 높이·추가거리를 포함한 경로 지정 → 저장.

질문은 `RUBI를 어느 길로 보내시겠습니까?`입니다. 참가자는 자기 보행이나 영상의 미적 선호가 아니라, 같은 출발·도착 조건에서 로봇에게 지정할 경로를 선택합니다. 안전/에너지/속도 중 특정 관점을 정답으로 제시하지 않습니다.

## 소개 자료의 생성

`tools/build-intro-media.mjs`가 실제 `Physics.rollout()`와 `OnnxNetworks`를 호출합니다. `public/models/rubi-web`의 동일 XML, STL, encoder.onnx, policy.onnx를 사용합니다. 별도 모델/가짜 관절 애니메이션/실물 촬영/생성형 영상은 사용하지 않습니다.

순서: 평지 → 5 cm → 7 cm → 9 cm → 11 cm 턱의 올라가기+내려오기 → 7 cm 턱 주변의 +1.2 m 평지 우회. 각 조건에서 첫 실행을 사용하며, 실패하면 영상 생성과 배포를 중단합니다. 실패한 시도를 성공할 때까지 반복해서 골라내지 않습니다.

Physics 0.002 s, policy 0.01 s, 기준 navigation command 0.50, 기존 감속/정규화/PD/초기화 규칙 그대로입니다. `0.50`을 실제 achieved speed라고 설명하지 않습니다.

960×540 / 30 fps 영상으로 고정 simulation time에 맞춰 프레임을 내보냅니다. 느린 렌더러에서도 영상이 느린 속도로 녹화되지 않게, 프레임 n의 시뮬레이션 시간이 n/30이 되도록 구성합니다. 50 Hz 원본 qpos 프레임 중 해당 시각 직전 프레임을 사용합니다. 프레임 양자화에 따른 끝부분 유지 외에는 실행 중간을 잘라내거나 배속을 변경하지 않습니다. 장면 경계는 서로 다른 독립 실행의 연결입니다.

화면 안에는 높이·거리 글자를 합성하지 않습니다. 소개 화면 아래 구간 선택 버튼에 각 예시를 설명합니다. 같은 렌더러/카메라 규칙을 사용합니다. 이 영상은 특정 설정의 시뮬레이션 예시이며 실물 로봇의 일반적 성공률 증거가 아닙니다.

## 브라우저 영상 호환성

`tools/encode-intro-compatible.mjs`가 같은 완성 프레임열을 VP9 WebM으로도 인코딩합니다. 실제 브라우저가 지원하는 코덱에 따라 H.264 MP4 또는 VP9 WebM 하나만 불러옵니다. 별도 동작을 촬영하거나 배속을 바꾸는 것이 아닙니다.

MP4만 지원 여부를 가정하지 않고, CI의 Chromium에서도 WebM을 실제로 디코딩·재생한 뒤에만 검증을 통과합니다. 각 파일의 해시와 해상도·시간이 manifest에 기록됩니다.

`manifest.json`에는 정책/모델 자산의 SHA-256, 주요 소스 hash, 제어 조건, 장면 순서, 실제 실행 성공과 시간, 영상 SHA-256을 저장합니다. 참가자 런타임은 로드한 자산 해시와 소개 자료의 해시가 다르면 본 문항 시작을 막습니다.

## 시청 및 선택 방식

모든 참가자에게 같은 영상과 순서/바로가기 목록을 제공합니다. 첫 재생 후 `예시를 확인했고 질문을 이해했다`는 본인 확인으로 진행합니다. 전체 길이를 강제 시청시키거나 시청률을 이해도의 증거로 삼지 않습니다. `tutorialCompleted`는 안내 확인 응답이지 객관적으로 100% 시청/집중했다는 주장으로 분석하면 안 됩니다.

기존 A/B 문항의 시청/중간종료/다시보기 중 선택 규칙은 유지합니다. 별도의 시청시간 연구 기능은 추가하지 않았습니다. 본 문항의 A/B는 여전히 메모리에 유지된 런타임에서 실행하며, 소개 영상으로 본 문항을 대체하지 않습니다.

주 선택지:

- `7 cm 턱을 통과하는 길 / A로 보내기`
- `0.8 m 더 돌아가는 길 / B로 보내기`

A/B가 바뀌면 설명과 버튼도 실제 route에 맞춰 함께 바뀝니다. `더`는 직접 경로 대비 추가 이동거리입니다. 직접 경로는 올라갔다 내려오는 플랫폼 통과로 설명합니다.

주 선택지는 둘뿐입니다. `tie` 버튼은 제거합니다. 기존 tie 데이터는 삭제·재해석하지 않습니다. 정보를 이해하지 못한 경우 별도의 접힌 안내에서 `이번 문항 넘기기`를 사용할 수 있으며 `choice=skip`, `skipReason=insufficient_information`으로 저장합니다. skip은 direct/detour의 중간값이나 무차별점 관측으로 처리하지 않습니다.

## 버전과 Google Sheets

새 참가자 저장 공간/세션에는 `same-policy-intro-binary-v6`, `labelConditionVersion=same-policy-intro-core-view-explicit-binary-v1`을 사용합니다. 이전 v5 기록/미전송 상태는 수정하거나 삭제하지 않습니다. 반복 참여는 기존 participantId를 유지하고 새 sessionId로 구분합니다.

배포된 Apps Script와 기존 비공개 Sheet는 변경하지 않습니다. 수집기 허용 ID 호환성을 위해 `experimentId=rubi-hpp-collector-v3`, `status=draft`를 유지합니다. 본 조사로 전환한 것이 아닙니다. 프로토콜 구분은 Sessions.protocolVersion 및 Trials.labelConditionVersion에 남습니다.

소개 자료의 정확한 `contentId`는 기존 수집기가 이미 기록하는 `tutorialVersion` 값에 `same-policy-intro-v1:<64자리 contentId>` 형식으로 포함합니다. 새 Sheet 열이나 Apps Script 재배포 없이 어떤 소개를 제공했는지 식별할 수 있습니다. 추가 세부 JSON은 로컬/전송 payload에는 있지만 기존 Apps Script가 모든 필드를 저장하지는 않습니다. 배경 응답의 중앙 저장은 기존처럼 마지막 완료 시점에 수행됩니다.

## 조건/범위

5/7/9/11 cm × +0.4/0.8/1.2/1.6 m의 고정 16문항을 유지합니다. 적응형 질문 알고리즘은 이번 범위에 없습니다. 소개로 능력 정보를 제공한 v6 선택을 v5의 무소개/tie 조건과 같은 실험으로 합치지 마세요.

## 재생성/검증

```sh
npm ci
npm install --no-save --package-lock=false playwright@1.56.0
npx playwright install --with-deps chromium
# ffmpeg + ffprobe가 PATH에 있어야 합니다.
node tools/build-intro-media.mjs
node tools/encode-intro-compatible.mjs
npm test
npm run build
node tools/browser-smoke.mjs
```

생성된 `public/media/rubi-intro-v1/`은 Pages 빌드 산출물입니다. Git에 대용량 영상을 직접 커밋하지 않고, CI에서 동일 입력 기준으로 생성/캐시합니다. 로컬에서는 영상 생성 명령 두 개를 먼저 실행해야 합니다.

검증은 실제 영상 디코딩, A/B 표시와 저장 route 일치, 다시보기 중 선택, 정보 부족 skip, 초기화/세션 재시작, 기존 실제 5/7/9/11 cm rollout을 포함합니다. UI 저장 테스트는 mock으로 가로채므로 실제 연구 시트에 테스트 데이터를 추가하지 않습니다.
