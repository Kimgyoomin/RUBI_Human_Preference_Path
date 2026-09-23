# 공개 설문·본 조사 저장 분리 점검 (v8)

## 범위
- 질문/정책/소개 영상의 실험 규칙은 `height-blocks-binary-v7` 그대로 유지한다.
- 공개 Pages 빌드는 참가자 화면만 포함한다. `?mode=research`를 붙여도 연구자 화면을 제공하지 않는다.
- 연구자 화면은 로컬 개발 서버에서만 사용한다. 이는 인증된 온라인 관리자 사이트를 추가한 것이 아니다.
- 본 조사용 새 Google Sheets를 준비하며, 기존 개발/파일럿 자료는 지우거나 이동하지 않는다.
- 비용 추정, 자동 모집 개시, 연구 승인 여부에 대한 판단은 이번 범위가 아니다.

## 공개 빌드 경계
`src/entry.ts`에서 연구자 모듈은 `import.meta.env.DEV` 분기에서만 동적 import한다. 공개 화면의 연구자 링크는 제거한다. Vite의 `publicBoundary` 빌드 검사는 공개 JS 모듈 목록에 `src/main.ts`가 남으면 빌드를 실패시킨다. 소스맵은 만들지 않는다. `tools/public-release-smoke.mjs`가 실제 배포용 빌드에 대해 query/hash 우회와 연구자 DOM 부재를 검사한다.

저장소 자체는 공개이다. 공개 모델/ONNX/과거 소스를 내려받거나 복제하여 별도로 실행하는 행위까지 막는 보안 기능은 아니다. 비공개 응답의 접근 통제는 Google Drive 권한으로 수행한다. 숨겨진 URL·브라우저 비밀번호·localStorage 플래그를 인증으로 사용하지 않는다.

## 연구자 로컬 실행
```bash
npm ci
npm run dev -- --host 127.0.0.1
# 표시된 localhost 주소에 /?mode=research 를 붙인다.
```
개발 서버를 외부 IP에 바인딩하거나 인터넷에 공개하지 않는다. `npm run build`의 결과는 항상 참가자 전용이다.

## 데이터셋 분리
- 기존 파일럿: `rubi-hpp-collector-v3`, `rubi-hpp-block-pilot-v7`, status `draft`; 기존 파일에만 저장.
- 새 본 조사: `rubi-hpp-main-v1`, status `released`; 새 파일에만 저장.
- 새 파일: https://docs.google.com/spreadsheets/d/1Az6wHrRmSTjS6PeUjm2dzwI406Hnd0fyYj_JzkYdg-4/edit
- 새 파일은 My Drive/root, 소유자만 접근 가능 여부를 별도로 확인한다. 파일 ID는 비밀키가 아니다.
- 클라이언트가 spreadsheetId/sheetName을 보내도 저장 위치를 바꾸지 않는다.
- `config/study.main.json`은 개시용 준비 설정이며 public 폴더 밖에 둔다. 이번 PR은 현재 `public/study.json`의 파일럿 설정을 바꾸지 않는다.

## 배포할 Apps Script 만들기
```bash
node tools/build-release-collector.mjs
# artifacts/RUBI_Collector_release_v8_Code.gs
```
출력 파일은 검증된 기본 수집기, 추가 release guard, 현재 브라우저와 동일한 질문 선택기를 합친 **한 개의 완전한 Code.gs**이다. 부분 조각만 붙이지 않는다. 기본 `apps-script/Code.gs`만 복사하면 새 본 조사 분리가 적용되지 않는다.

기존 Apps Script 편집기의 Code.gs를 생성 파일 전체로 교체하고 저장한다. **배포 → 배포 관리 → 기존 웹 앱 편집 → 새 버전 → 배포**를 사용하면 기존 `/exec` URL을 유지할 수 있다. 기존 파일럿은 계속 기존 파일로 저장된다.

새 수집기의 `collectorVersion`은 기존 v7 저장 계약을 유지하며, 별도 `releaseVersion = isolated-main-collector-v8`로 분리 기능을 식별한다. 본 조사용 ping은 시트 구조와 datasetTag를 읽기만 하며 응답/개인정보/행 수를 반환하지 않는다.

## 본 조사 개시·중지
초기 상태는 서버 측 **닫힘**이다. `RUBI_MAIN_COLLECTION_OPEN` Script Property가 문자열 `true`일 때만 본 조사 쓰기를 허용한다. 공개 웹 URL/POST로 이 값을 바꾸는 경로는 없다.

1. 새 수집기를 먼저 배포한다.
2. 소유자가 Apps Script 편집기에서 `inspectMainCollection`을 실행하여 대상 ID와 0건 상태를 확인한다. 이 함수는 데이터 쓰기를 하지 않는다.
3. 실제 배포 URL의 읽기 전용 ping에서 releaseVersion/datasetTag/schemaReady를 확인한다. 초기 collectionOpen은 false여야 한다.
4. 연구 설명·동의·연락처·보관/철회 방침과 기관의 필요한 검토 여부를 연구자가 확정한다. 이번 코드 검사로 연구 승인을 받았다고 표현하지 않는다.
5. 연구자가 모집 개시를 승인한 시점에 `openMainCollection`을 편집기에서 실행하고 `config/study.main.json`을 `public/study.json`으로 반영·검증·배포한다. 한쪽만 열려 있으면 프런트나 서버에서 차단된다.
6. 중지하려면 편집기에서 `pauseMainCollection`을 실행한다. 사이트 화면을 조작해도 서버가 새 본 조사 저장을 받지 않는다. 이미 접수·실행 중인 요청을 취소하는 기능은 아니다.

새 시트에 개발용 가짜 응답을 넣지 않는다. 필요한 실수집 스모크 테스트는 연구자 지정 검증 세션으로 구분하거나 별도 파일럿에서 수행한다. 이 작업에서는 실제 본 조사 응답이 저장되었다고 주장하지 않는다.

## 추가 서버 검증
본 조사에서만 16문항·4개 높이·승인된 후보·명령·A/B 배정·동일 seed 계획·이전 완료 응답과 다음 질문 일치를 검사한다. 모델 정책 해시/소개 버전 형식/계획 길이와 동의 상태를 검사한다. 기록의 서버 대상·사전 경험·질문 계획을 클라이언트가 변경하면 거부한다. 동일 ID 재시도는 누락 연결을 복구하며 원본 답을 수정하지 않는다.

인터넷에서 들어오는 입력의 형식·순서는 검증할 수 있지만, 클라이언트가 실제로 보행을 보았는지·실제로 사람이 눌렀는지 증명하지는 않는다. 별도 로그인/CAPTCHA/초대코드를 구현하지 않았으므로 익명 공개 수집 API에 대한 자동 제출/스팸 위험과 Apps Script 동시 실행 한도는 남는다. 시뮬레이션 데이터를 인위적으로 조작한 참가자의 진위까지 서버가 보증한다고 표현하지 않는다.

## 검증 범위
- 로컬: 생성 수집기와 메모리 Google 서비스로 닫힘/라우팅/잘못된 입력/16응답32실행/중간실패복구/완료 처리 검사.
- CI: 전체 유닛·타입·실제 정책의 모든 지형 후보·기존 참가자 8문항 회귀.
- CI: **production build**에 대한 연구자 query/hash 접근 차단, 비공개 파일/소스맵 미배포, 본 조사 닫힘 gate, 실제 모델의 한 문항과 새 수집기 저장 계약(메모리 서비스).
- 실제 Google 본 조사 쓰기·소유자의 새 배포·실제 모집 개시는 별도 확인 사항이다.
- 현행 설문 절차 자체의 통계 타당성, 실제 로봇 안전성, 대규모 동시 제출 부하, 모든 모바일/Safari 조합은 이번 검사만으로 보장하지 않는다.
