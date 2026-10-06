# 시제품 경로 선택 설문 — 외부 파일럿 v9

## 범위 고정
질문 프로토콜은 height-blocks-no-repeat-v9 그대로다. 5·7·9·11 cm, 높이당 4문항, 0.4–2.4 m 후보, 0.2 m 간격, 같은 높이 내 거리 재질문 없음. 로봇·ONNX·카메라·제어기·소개 제작 조건·문항 안내는 바꾸지 않았다. 최종 검증된 모집이나 비용 정확도를 보장하는 단계가 아니라 시제품 외부 파일럿이다.

## 참가자 링크
https://kimgyoomin.github.io/RUBI_Human_Preference_Path/

기본 주소는 external-pilot-v2로 열리고 참가자에게 개발자 점검 ID/제외 안내/연구자 화면을 표시하지 않는다. 2026-10-06 실제 수집 시트 초기화 이후 브라우저에 남아 있던 external-pilot-v1 진행 상태와 서버 원본의 불일치를 끊기 위해 **localStorage namespace만 v2로 회전**했다. 질문·수집기·Google Sheet·sessionId 형식은 바꾸지 않았다.

이미 열려 있던 external-pilot-v1 탭은 그 탭에 로드된 기존 설정으로 계속 제출할 수 있고 서버에 저장된 v1 응답은 삭제·변환하지 않는다. 새로고침 또는 새 접속부터 v2 저장공간을 사용하므로, 과거 v1 localStorage는 자동으로 이어받지 않는다. 완료 후 반복참여 버튼은 숨기며, 인증을 추가한 것은 아니므로 여러 기기 참여를 완전히 막지는 않는다.

## 점검과 외부 응답 분리
- 외부 파일럿 신규 접속: sessionId = pilot-<UUID>, localStorage key suffix :external-pilot-v2.
- 이전 외부 탭: :external-pilot-v1 상태와 이미 서버에 저장된 pilot- 응답은 그대로 보존한다.
- 개발자 점검: ui-check-<UUID>, 기존 localStorage 및 응답 보존. 분석에 합치지 않는다.
- 추가 점검 주소: https://kimgyoomin.github.io/RUBI_Human_Preference_Path/?collection=ui-check&protocol=current
- v7 점검 복구: ?protocol=legacy-v7. 이는 연구자 권한 부여가 아니라 기록 구분용 설문이다.
- ID 접두사로 구분하는 것은 실제 사람/진위 인증이 아니다. 외부 파일럿에는 v9이며 pilot-로 시작하는 세션만 포함 후보로 삼는다. 완료 여부/건너뛰기/집단별 제외 기준은 분석 계획에서 별도로 정한다.

## 저장소·배포
기존 비공개 Google Sheets 파일 ID 1Az6wHrRmSTjS6PeUjm2dzwI406Hnd0fyYj_JzkYdg-4를 그대로 사용한다. namespace 회전은 서버 데이터를 지우지 않는다.
내부 experimentId=rubi-hpp-main-v1, datasetTag=main-v1, v9 수집기, /exec 주소를 그대로 사용한다. 내부 이름 main은 통계적 본 조사 확정이라는 뜻이 아니다.
Code.gs 변경·재배포 불필요. RUBI_MAIN_COLLECTION_OPEN=true를 유지한다. 중지하려면 소유자가 같은 Apps Script 속성을 false로 바꾸면 된다.

## 저장 실패와 완료 처리
각 문항은 서버 성공 응답을 받은 뒤에만 브라우저 진행 상태가 다음 문항으로 이동한다. 이미 `saveState=complete`로 서버에 들어간 Trials/Runs는 창을 닫아도 남는다. 반면 현재 화면의 pending 문항이 서버 저장에 실패한 상태에서 창을 닫으면 그 문항은 서버 원본에 없을 수 있다.
16문항이 모두 저장되어도 마지막 profile/finalize 요청이 실패하면 Sessions.status는 started로 남을 수 있다. 이 경우 원본 16 Trials/32 Runs는 보존되지만 'completed' 표시는 보장되지 않는다. 따라서 분석 시 status와 실제 연결 행 수를 함께 확인한다.

## 공유 안내 예시
두 다리로 걷는 로봇 RUBI의 경로 선택 설문입니다. 소개 영상을 본 뒤, 같은 목적지로 가는 두 길 중 로봇에게 지정할 길을 선택해 주세요. 로봇 관련 지식 없이 참여할 수 있으며 총 16문항입니다. PC의 Chrome 사용을 권장합니다. 이름·이메일은 묻지 않으며 참여 안내를 읽고 동의한 뒤 진행해 주세요. 같은 설문에는 한 번만 참여해 주세요.

## 운영 원칙
한 파일럿 배치 동안 질문·소개·거리 범위를 고정한다. v7/v9/개발자 점검을 섞어서 비용을 계산하지 않는다. 비용 추정은 수집 후 별도로 한다. 시트는 공개하지 말고 참가자에게 웹페이지 링크만 전달한다. 연구윤리/모집 절차의 승인 여부는 이 코드 변경으로 결정하거나 보장하지 않는다.

## 검증
배포 전 단위검사와 공개 빌드의 실제 WASM 보행/첫 묶음/저장 복구/목적 전환 검사를 수행한다. 자동검사의 Google 쓰기는 메모리 모형으로 대체하며 실제 응답을 만들지 않는다. 배포 후에는 공개 첫 화면과 읽기 전용 ping만 검사하고 기존 서버 응답 건수가 줄지 않았는지 별도로 확인한다.
