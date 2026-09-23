# 공개 설문·본 조사 저장 분리 점검 (v8)

## 범위
질문/정책/소개 영상의 실험 규칙은 `height-blocks-binary-v7` 그대로 유지한다. 공개 Pages는 참가자 화면만 제공하고 연구자 화면은 로컬 개발 서버에서만 사용한다. 본 조사용 새 Google Sheets를 준비하며 기존 개발/파일럿 자료는 지우거나 이동하지 않는다. 비용 추정·모집 자동 개시·연구 승인 판단은 이번 범위가 아니다.

## 공개 빌드와 로컬 연구자 도구
`src/entry.ts`의 연구자 import는 `import.meta.env.DEV` 분기에서만 실행된다. `?mode=research`를 공개 URL에 붙여도 참가자 화면만 나온다. 공개 링크도 제거한다. Vite의 `publicBoundary` 검사는 공개 모듈 목록에 `src/main.ts`가 남으면 빌드를 실패시킨다. 소스맵은 만들지 않는다. 배포용 빌드를 대상으로 query/hash와 localStorage 플래그 변경, 연구자 DOM 및 소스맵 부재를 검사한다.

```bash
npm ci
npm run dev -- --host 127.0.0.1
# 표시된 localhost 주소에 /?mode=research 를 붙인다.
```
로컬 개발 서버를 인터넷에 공개하지 않는다. 이 구조는 인증된 온라인 관리자 사이트를 추가한 것이 아니다. 공개 저장소의 소스/모델/ONNX를 내려받거나 복제해서 별도로 실행하는 것까지 막지는 않는다. 비공개 응답 접근은 Google Drive 권한으로 통제한다. 브라우저 비밀번호나 숨겨진 URL을 인증으로 사용하지 않는다.

## 데이터셋 분리
- 기존 파일럿: `rubi-hpp-collector-v3`, `rubi-hpp-block-pilot-v7`, `draft` → 기존 파일.
- 본 조사: `rubi-hpp-main-v1`, `released` → 새 파일.
- 새 파일: https://docs.google.com/spreadsheets/d/1Az6wHrRmSTjS6PeUjm2dzwI406Hnd0fyYj_JzkYdg-4/edit
- 내 드라이브 최상위에 준비하고 소유자만 접근 가능 여부와 빈 데이터 탭을 확인한다.
- 저장 위치는 서버가 고정한다. 클라이언트의 spreadsheetId/sheetName으로 바꾸지 않는다.
- `config/study.main.json`은 개시용 준비 설정으로 public 폴더 밖에 둔다. 이번 PR은 현재 공개 파일럿 설정을 바꾸지 않는다.

## 배포할 완전한 Code.gs
```bash
node tools/build-release-collector.mjs
# artifacts/RUBI_Collector_release_v8_Code.gs
```
생성물은 기본 수집기+release guard+현재 브라우저와 동일한 질문 선택기를 합친 한 파일이다. **기본 `apps-script/Code.gs`만 복사하거나 guard 조각만 붙이면 안 된다.** 생성 파일 전체로 기존 Apps Script Code.gs를 교체한다.

기존 프로젝트에서 **배포 → 배포 관리 → 기존 웹 앱 편집 → 새 버전 → 배포**한다. 기존 `/exec` URL은 유지할 수 있으며 파일럿은 계속 기존 시트로 저장한다. 새 시트에 별도의 Apps Script 프로젝트를 만들 필요는 없다.

기존 `collectorVersion=repairable-block-collector-v7` 계약은 유지한다. 별도 `releaseVersion=isolated-main-collector-v8`와 `datasetTag`로 분리 기능을 식별한다. 본 조사 ping은 구조와 개시 상태만 반환하고 파일 ID·응답·개인정보·행 수를 반환하지 않는다.

## 서버 측 개시·중지와 RPC 차단
본 조사 저장은 처음에는 닫혀 있다. Script Property `RUBI_MAIN_COLLECTION_OPEN`이 문자열 `true`여야 쓰기를 받는다. 공개 웹 요청은 `ping/trial/profile`만 처리한다.

관리자 함수는 `inspectMainCollection_`, `openMainCollection_`, `pauseMainCollection_`처럼 **이름 끝에 `_`를 붙인다**. HtmlService는 일반 서버 함수를 `google.script.run`으로 노출할 수 있으므로 doPost 경로에서 제외하는 것만으로 부족하다. 끝에 `_`가 붙은 함수는 Google 문서에 따라 클라이언트 RPC에서 호출할 수 없다. 생성 스크립트의 공개 최상위 함수가 `doGet/doPost`뿐인지 검사한다.
공식 근거: https://developers.google.com/apps-script/guides/html/communication#private_functions

개시 순서:
1. 소유자가 새 생성 Code.gs를 기존 웹 앱에 재배포한다.
2. 편집기에서 `inspectMainCollection_`를 실행해 대상 ID·0건·닫힘을 확인한다. 이 함수는 데이터 쓰기를 하지 않는다.
3. 실제 배포 URL의 읽기 전용 ping으로 releaseVersion/datasetTag/schemaReady와 collectionOpen=false를 확인한다.
4. 연구 설명·동의·연락처·보관/철회 방침과 기관의 필요한 검토 여부를 연구자가 확정한다. 코드 검증을 연구 승인이라고 표현하지 않는다.
5. 연구자가 명시적으로 개시를 승인한 뒤 `openMainCollection_`를 편집기에서 실행하고 `config/study.main.json`을 `public/study.json`으로 반영·검증·배포한다. 한쪽만 준비되어 있으면 개시하지 않는다.
6. 중지할 때 `pauseMainCollection_`를 편집기에서 실행한다. 이미 실행 중인 요청을 취소하는 기능은 아니다.

함수를 실행하는 대신 소유자가 프로젝트 설정의 Script Properties에서 해당 키를 수정할 수도 있다. 공개 클라이언트에는 이 설정을 변경하는 기능을 제공하지 않는다.

현재 테스트는 공개 파일럿을 유지하는 사전개시 상태를 확인한다. 실제 개시 PR에서는 `tests/release-collector.test.mjs`의 파일럿 유지 검사 및 production smoke 설정도 의도한 본 조사 상태로 함께 갱신해야 한다. 변경 없이 main 설정만 덮어쓰고 검사를 우회하지 않는다.

## 입력 검증과 복구
본 조사에서는 16문항·4개 높이·거리 후보·명령·A/B 배정·seed 계획·이전 완료 응답과 다음 질문 일치를 검사한다. 정책 해시·소개 버전 형식·계획 길이·동의 상태도 검사한다. 같은 세션의 배경정보·질문계획 변경은 거부한다. 동일 ID 재시도는 원본 답을 수정하지 않으면서 연결 누락을 복구한다.

새 시트에 임의 개발 응답을 넣지 않는다. 실제 저장 스모크 테스트가 필요하면 사전에 연구자가 지정한 검증 세션으로 구분하거나 별도 검증 파일을 사용한다.

## 검증 범위와 한계
- 생성 수집기+메모리 Google 서비스: 닫힘/분리/비정상 입력/16응답32실행/중간실패 복구/완료/RPC 함수 노출 검사.
- 기존 CI: 전체 유닛·타입·실제 정책의 지형 후보·참가자 8문항 회귀.
- production build: 연구자 주소와 플래그 차단, 소스맵·내부 파일 미배포, 본 조사 닫힘 gate, 실제 모델의 한 문항과 생성 수집기 저장 계약(메모리 서비스).
- 실제 Google 본 조사 쓰기·소유자의 새 배포·실제 모집 개시는 별도 확인 사항이다.

공개 소스나 클라이언트 입력만으로 실제 사람·실제 시청·실제 실행을 증명할 수 없다. 로그인/CAPTCHA/초대코드를 추가하지 않았으므로 자동 제출·스팸 위험과 Apps Script 실행 한도는 남는다. 현행 질문의 통계 타당성, 실물 로봇 안전성, 대규모 동시 제출 부하, 모든 모바일/Safari 조합도 이 검사만으로 보장하지 않는다.
