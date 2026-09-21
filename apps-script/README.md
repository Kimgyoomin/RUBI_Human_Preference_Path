# Google Apps Script 응답 수집기

이 폴더는 별도 서버 없이 GitHub Pages 설문 응답을 Google Sheets에 저장하기 위한 Apps Script Web App 코드입니다.

## 대상 시트

- Spreadsheet ID: `1u7mXgUFagYepp1oOxVohs5x7i7bCfnBVZbQKKcwOYQA`
- 파일: **RUBI Human Preference Path — 수집 데이터 v3 초안**
- 위치: 사용자의 **내 드라이브**
- 탭: `Trials`, `Runs`, `Sessions`, `Estimates`

Spreadsheet ID는 접근 비밀키가 아닙니다. 실제 쓰기 권한은 Apps Script를 배포한 Google 계정에서만 가집니다.

## 최초 배포

1. 위 Google Sheet를 엽니다.
2. **확장 프로그램 → Apps Script**.
3. 기본 `Code.gs`를 이 폴더의 [Code.gs](./Code.gs) 내용으로 교체합니다.
4. 저장합니다.
5. **배포 → 새 배포 → 유형: 웹 앱**.
6. 실행 사용자: **나**.
7. 액세스 권한: 설문 참가자가 로그인하지 않도록 접근 가능한 범위를 선택합니다.
8. 배포 후 생성되는 **`https://script.google.com/macros/s/.../exec`** 주소를 복사합니다.
9. 연구자 화면의 **Apps Script Web App 주소**에 붙여 넣고 **저장 연결 확인**을 누릅니다.

Apps Script 편집기의 비밀값이나 Google 계정 토큰을 GitHub에 올리지 마세요.

## 저장 계약

브라우저는 `no-cors` fire-and-forget을 사용하지 않습니다. 숨겨진 form/iframe으로 POST하고, Apps Script가 실제 시트 저장을 마친 후 `postMessage`로 성공을 확인합니다.

- `ping`: 시트에 쓰지 않고 experiment/status 호환성 확인
- `trial`: Trials 1행 + Runs 2행 + Sessions 기본 행 생성
- `profile`: 마지막 참가자 배경 설문을 같은 Sessions 행에 업데이트

`submissionId`가 이미 Trials에 있으면 새 행을 만들지 않고 성공(duplicate)으로 응답합니다. 실제 쓰기 구간은 `LockService`로 보호합니다.

## 현재 단계

이 저장소의 코드는 collector를 지원하지만, Apps Script Web App의 실제 배포는 Google UI에서 한 번 수행해야 합니다. `/exec` URL을 얻기 전에는 공개 사이트가 중앙 저장 완료로 표시하지 않습니다.
