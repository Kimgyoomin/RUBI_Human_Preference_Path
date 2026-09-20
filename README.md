# RUBI Human Preference Path

RUBI 이족 로봇의 경로 선호를 수집하는 독립적인 브라우저 WASM 앱입니다. ROS/Gazebo 저장소와 분리되어 있습니다.

## 빠른 실행

Node.js 24를 사용합니다.

```bash
npm ci
npm test
npm run dev
```

브라우저에서 http://127.0.0.1:5173 을 열고 XML, ONNX 두 개, STL 9개가 들어 있는 폴더를 선택합니다. 파일 선택은 브라우저 내 읽기이며 서버 업로드가 아닙니다.

## 실행 구조

MuJoCo WASM -> 관측 구성 -> encoder.onnx (330 -> 32) -> policy.onnx (65 -> 6) -> PD torque -> MuJoCo step. 물리 dt=0.002 s, 추론 dt=0.01 s입니다. 두 경로를 계산한 뒤 simulation time 기준 1x로 재생합니다.

## 배포

Settings -> Pages -> Source: GitHub Actions를 선택한 다음 Actions -> RUBI WASM Web -> Run workflow에서 deploy를 체크합니다. GitHub Pages가 비활성 또는 현재 요금제에서 불가능하면 build만 수행하고 deploy는 건너뜁니다. Private 저장소의 Pages에는 GitHub Pro/Team 등 해당 기능을 지원하는 요금제가 필요합니다. 저장소를 임의로 Public으로 변경하지 않습니다.

## 모델 자료와 공개 범위

웹에서 배포하는 XML/STL/ONNX는 참가자가 다운로드할 수 있습니다. 공개를 승인한 자료만 public/models/rubi/에 넣습니다. XML은 질량, 관성, 관절, 접촉 등 시뮬레이션 정보도 포함합니다.

## 설문

public/study.json은 draft로 시작합니다. 이는 준비/파일럿 화면이지 본 조사 승인 상태가 아닙니다. released 전환 전에 실제 RUBI 보행과 변인통제를 검증하고 별도 응답 API를 연결해야 합니다. API 코드는 api/server.mjs, 상세 초기 설명은 docs/UPSTREAM_WEB_README.md를 참고하세요. GitHub Pages 자체는 응답 DB를 실행하지 않습니다.

## 검증 한계

제어 계산 테스트 통과가 Gazebo와 MuJoCo에서 같은 보행을 보장하지는 않습니다. 실제 STL과 정책을 연결한 평지/단차 보행은 별도 검증 대상입니다.
