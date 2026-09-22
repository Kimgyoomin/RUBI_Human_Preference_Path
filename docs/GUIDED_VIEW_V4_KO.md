# 참가자 보행 화면 / resident-guided-v4

## 접속

- 기본 URL: 참가자 안내형 화면.
- `?mode=research`: 기존 연구자 workbench. 슬라이더, 전체 경로 생성, 실행 기록 내보내기를 유지합니다.
- Apps Script나 Google Sheets 파일/권한을 변경하거나 새로 배포할 필요는 없습니다.

## 참가자 순서

동의 → 참가 전 경험 3문항 → RUBI와 조작 안내 → 경로 A 보기 → 경로 B 보기 → 높이/추가거리 확인 및 선호 선택 → 저장 확인 → 다음 문항.

참가자는 `두 경로 보행 생성`을 누르지 않습니다. 첫 A/B 관찰은 해당 경로를 실제로 추종하는 live MuJoCo/ONNX 실행입니다. 다시 보기는 동일 실행의 기록을 사용합니다. 한 경로라도 완주하지 못하면 선호 응답은 열리지 않습니다.

## 보행 시각화

- Viewport 내부에 높이 숫자, 거리, START, GOAL, 상태 배지, 타임라인을 표시하지 않습니다.
- 출발: 초록 채운 원. 목표: 빨강 동심 표적. 색 외에도 형태로 구분합니다.
- 진행 축(+X)을 향하는 측후방 사선 시점. 카메라 위치는 XY만 완만하게 따라가며 몸통 yaw/roll/pitch와 높이 흔들림은 따라가지 않습니다.
- A/B 시작 때 동일한 카메라 offset과 target으로 복원합니다.
- 참가자 카메라는 고정된 규칙으로 작동합니다. 자유 카메라는 연구자 화면에 유지합니다.
- 숫자는 두 경로를 확인한 선택 화면에서만 제시합니다. 다시 보기를 누르면 선택 화면을 숨깁니다.
- 렌더링 상한은 30 FPS이며 물리 500 Hz / 정책 100 Hz와 독립적입니다.

이는 UI 설계 조건이지, 이 카메라가 인간 선호 측정에 최적이라는 검증 결과는 아닙니다. 파일럿 피드백으로 framing/문구를 조정할 수 있습니다.

## 유지하는 것과 초기화하는 것

유지: WASM module, XML/STL에서 만든 MjModel, MjData 할당, encoder/policy session, robot rendering geometry.

경로마다 초기화: mj_resetData에 포함된 물리·적분 상태, 제어기 history/previous action/gait phase/inference counter, follower progress. qpos0의 XY Start는 (0,0)입니다. ONNX session을 다시 만들지 않습니다.

플랫폼은 1–12 cm 정수 높이의 정적 geom bank로 한 번 compile합니다. 각 trial 사이에 선택 높이의 contype/conaffinity만 활성화하고 parent-body mask union을 갱신합니다. 플랫폼 치수를 실행 중 바꾸거나 접촉 중 지형을 이동하지 않습니다. 0 cm에서는 bank 전체 비활성입니다. Three.js는 선택된 플랫폼 하나만 표시합니다.

동일 장면의 A/B 강조 변경은 path opacity만 갱신하며 world geometry/material을 재생성하지 않습니다.

MuJoCo 원문 참고: https://mujoco.readthedocs.io/en/latest/programming/simulation.html
ONNX session 원문 참고: https://onnxruntime.ai/docs/api/js/interfaces/InferenceSession.html

## Live timing과 다시 보기

고정된 물리 step과 inference 순서를 모두 실행하며, wall clock에 맞추려고 timestep을 늘리거나 inference를 건너뛰지 않습니다. 숨겨진 탭에서는 프레임 경계에서 멈춥니다.

보이는 시간 기준 RTF가 0.90 미만이거나 프레임 콜백 사이 400 ms 초과 지연이 있으면 즉시 선호 응답을 받지 않고 기록된 보행을 다시 보도록 합니다. 이 값들은 현재 파일럿용 기준이지 디스플레이 품질의 보편적 인증 기준이 아닙니다. 느린 장치에서 다시 보기까지 기준을 충족하지 못하면 다른 기기에서 확인해야 합니다.

run의 visibleWallMs, realTimeFactor, maxDisplayGapMs, displayMode는 로컬 원본 응답에 기록합니다. 기존 Apps Script는 아직 모든 추가 필드를 Sheets 열로 옮기지는 않습니다.

## 높이 / 문항

`guidedScenarios`는 5/7/9/11 cm × 추가거리 0.4/0.8/1.2/1.6 m의 **고정 16문항 파일럿**입니다. 네 높이를 interleave하고 각 높이 안의 거리 및 A/B 배치를 무작위화합니다.

**adaptive search는 아직 아닙니다.** 새로운 UI/runtime을 검증한 뒤 별도의 버전으로 추가해야 합니다. 기준 raw navigation command는 0.50이며 achieved speed가 반드시 0.50 m/s라는 뜻이 아닙니다. 기존 command mapping, policy, PD, dt, lookahead/yaw 제한은 유지합니다.

단일 초기조건에서의 시뮬레이션 성공을 실제 로봇의 성공확률이나 안전 보장으로 해석하지 않습니다.

## 데이터와 기존 Apps Script의 호환

배포된 collector가 `rubi-hpp-collector-v3`만 허용하므로 experimentId는 그대로 둡니다. 대신 아래 필드로 이전 화면의 기록과 분리합니다.

- Sessions.protocolVersion = `resident-guided-v4`
- Trials.labelConditionVersion = `rear-oblique-no-labels-then-numeric-v1`
- trialId의 `guided-v4-` 접두사
- tutorialVersion = `guided-instructions-v1`
- 별도 브라우저 저장 key와 새 sessionId

기존 3개 개발 응답을 삭제하거나 새로운 조건의 응답으로 바꾸지 않습니다. 분석 시 protocol/labelConditionVersion을 반드시 필터링합니다. 본 조사 release 전에 독립 experimentId와 collector allowlist를 함께 갱신하는 것을 권장합니다.

배경 질문은 시뮬레이션 **이전**에 수집하고 로컬에 보관합니다. 기존 profile endpoint는 호출 시 Sessions를 completed로 만들기 때문에, **원격 profile 확정 호출만 조사 완료 시점**에 수행합니다. 따라서 중도 이탈자의 배경 정보는 아직 자동으로 Sheets에 확정되지 않을 수 있습니다. 이 제한을 해결하려면 Apps Script에 pre-profile/session-start 이벤트를 별도로 추가하고 재배포해야 합니다. 현재 변경은 사용자에게 불필요한 재배포를 요구하지 않기 위해 기존 endpoint 의미를 유지합니다.

문항 응답은 매번 POST 직전 동일 submissionId와 payload를 로컬에 보관하고, 실제 저장 확인을 받아야 다음 문항으로 이동합니다. 불명확한 no-cors 제출 성공으로 간주하지 않습니다.

## 검증

- 순수 함수/제어/자산 검사: npm test.
- 연구자 기존 브라우저 테스트 유지.
- real policy resident tests: 5→7→9→11→5 cm, 같은 MjModel과 runtime ID 유지, A/B 초기 qpos/qvel 일치 및 5 cm 재실행 궤적 일치 검사.
- guided UI: 사전 질문 전에 모델 생성 0회, 진행 중 model/ONNX 생성 각각 1회, 무문자 viewport, A/B gating, 실제 보행, 선택과 완료.
- CI의 guided 저장 요청은 mock으로 가로채며 실제 연구 시트에 테스트 응답을 쓰지 않습니다. 실제 Apps Script는 ping만 검사합니다.
- 결과와 실제 화면: Actions browser-diagnostics artifact.
