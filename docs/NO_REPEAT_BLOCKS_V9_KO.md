# 높이별 미제시 거리 우선 설문 v9

## 확정한 변경 범위
- A/B 선택, 5·7·9·11 cm, 높이별 연속 4문항(총 16문항)은 유지한다.
- 추가 우회거리 후보는 0.4–2.4 m, 0.2 m 간격이다. 전체 길이가 아니라 직진 경로 대비 추가거리다.
- 같은 높이에서 동일 거리를 자동으로 다시 묻지 않는다. skip도 이미 제시한 조건으로 센다.
- 슬라이더, 실시간 비용 추정, 추가 점수·가상 위험 패널티는 만들지 않는다.
- 로봇 모델, ONNX, 제어기·속도 명령·카메라·소개 영상 제작 조건은 바꾸지 않는다.

## 정확한 질문 규칙
첫 두 문항은 0.4 m와 2.4 m이며 짧음/김 시작 순서는 참여별로 배정된다. 네 높이 중 두 개는 짧은 쪽에서, 두 개는 긴 쪽에서 시작한다. 높이 순서는 섞고, 각 높이에서 direct의 A/B 배정은 두 번씩이다.

이후 질문은 해당 높이에서 아직 제시하지 않은 거리만 사용한다.
1. skip이 있으면: 이미 보여준 모든 거리에서 가장 멀리 떨어진 미제시 후보를 묻는다.
2. 전부 direct라면: 남은 후보 중 가장 짧은 거리(보통 0.6, 0.8 m).
3. 전부 detour라면: 남은 후보 중 가장 긴 거리(보통 2.2, 2.0 m).
4. detour가 나온 최대거리보다 direct가 나온 최소거리가 크면: 그 사이 미제시 후보 중 중간에 가장 가까운 거리.
5. 응답이 단조 관계와 맞지 않거나 구간 안에 미제시 후보가 없으면: 범위 확인 질문(1과 같은 거리 간격 기준).

범위 확인 동률은 전체 범위 중간값과 가까운 후보, 그 다음 seed로 미리 배정한 lower/upper 규칙으로 결정한다. 중간값 동률에도 이 규칙을 사용한다. 답변 삭제·다수결 교정·같은 질문 반복을 하지 않는다.

전체 경과와 원본 choice를 저장한다. queryContext.state는 질문 선택 이유이며 비용 추정이나 참가자 판정 결과가 아니다. 마지막 두 답의 중간값을 cost로 자동 저장하지 않는다. 상한에서 우회를 선택했다고 cost=2.4 m로 확정하지 않는다. 추가범위에서도 전환점이 관측되지 않을 수 있고, 네 문항이 0.2 m 정확도나 신뢰구간을 보장하지 않는다.

## 버전과 저장
- protocolVersion: `height-blocks-no-repeat-v9`
- adaptiveVersion: `endpoint-unseen-v1`
- candidateSetId: `detour-400-2400-step200-v2`
- labelConditionVersion: `same-policy-intro-no-repeat-binary-v3`
- 새 프로토콜의 ping releaseVersion: `no-repeat-collector-v9`
- 기존 v7 ping에는 `isolated-main-collector-v8`을 유지한다(하위호환).
- 동일한 본 조사 저장 파일을 사용하고 protocolVersion/세션으로 분리한다. 기존 응답은 변경·삭제하지 않는다.
- 점검 단계의 `ui-check-` 세션은 본 조사 분석에서 제외한다. 이번 배포는 일반 모집 개시가 아니다.

## 진행 중인 참여 보호
기존 `src/core/height-block-study.ts`, `public/study.legacy-v7.json`은 v7 그대로 보존한다. 열려 있는 기존 창은 v7로 계속 제출할 수 있다. 새 수집기는 두 버전을 모두 검증한다.
새 페이지에서도 미완료 v7 로컬 기록이 있으면 기본적으로 v7를 이어간다. 기존 상태를 v9로 변환하지 않는다. 기존 환영/완료 화면의 ‘새 질문 방식으로 별도 시작’ 버튼 또는 `?protocol=current`는 별도 v9 참여를 시작한다. 예전 응답·로컬 키를 삭제하지 않는다. `?protocol=legacy-v7`로 기존 참여를 다시 열 수 있다. pending 답변이 있으면 먼저 저장을 확인한다.

## 적용 순서 — 기존 Apps Script 프로젝트 하나만 사용
1. `node tools/build-no-repeat-collector.mjs`가 만드는 **완전한 단일 파일** `artifacts/RUBI_Collector_no_repeat_v9_Code.gs`(또는 같은 내용 TXT)를 사용한다. 기본 `apps-script/Code.gs`만 붙여넣으면 안 된다.
2. 기존 배포 ID `AKfycbzkk-mfGemkhbChiP7ldNRfIUYLNJTVzVh40JtScTIYSG2qP6QpWh9rtFHsOKfSvnTnWw`를 가진 프로젝트의 Code.gs 전체만 교체한다. 새 시트에서 새 프로젝트를 만들지 않는다.
3. 배포 → 배포 관리 → 기존 배포 편집 → 새 버전 → 배포. 같은 /exec 주소를 유지한다.
4. `RUBI_MAIN_COLLECTION_OPEN=true`는 기존 프로젝트 속성 그대로 둔다. 생성 코드가 이 값을 초기화하거나 자동으로 닫지 않는다.
5. 웹 배포 이후 새 방식 테스트는 `https://kimgyoomin.github.io/RUBI_Human_Preference_Path/?protocol=current`에서 한다. 기존 창은 계속 v7로 유지할 수 있다.
6. 새 수집기 반영 전 새 v9 참여는 저장 서비스 업데이트 안내로 막힌다. 기존 v7 이어하기는 v8/v9 수집기 양쪽에서 계속 가능하다.
7. 첫 묶음에서 서로 다른 네 거리, 원본 4행·연결된 실행 8행·started 세션 1행을 확인한다. 재시도는 같은 ID로 복구한다.

공식 배포 방법: https://developers.google.com/apps-script/concepts/deployments
프로젝트 속성: https://developers.google.com/apps-script/guides/properties

## 검증 및 해석 범위
단위검사: 81개 응답 패턴 × 64개 seed, 네 높이/16문항, 미제시 후보, skip·불일치, 기존/신규 세션 분리, 부분 쓰기 실패 전후 재시도, 두 프로토콜의 16응답·32실행 완료 검사를 포함한다.
CI 브라우저 검사: 실제 로봇 정책으로 4개 높이×11개 우회 후보 및 직접 경로, 실제 공개 설정의 첫 묶음, 새로고침·수집 닫힘·v7 복구·연구자 기능 배제 검사. Google 응답 쓰기는 메모리 모형으로 대체하며 실제 연구 시트에 자동 시험자료를 넣지 않는다.
테스트 결과는 해당 CI 실행을 확인해야 한다. 시뮬레이션의 목표 도착·자동검사 통과는 설문의 통계 타당성이나 실물 안전성을 입증하지 않는다. 실제 v9 Google 저장은 소유자가 새 코드를 재배포한 뒤 점검 응답으로 확인해야 한다.
