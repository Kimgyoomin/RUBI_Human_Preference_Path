# 모델 연결 및 검증 순서

이 저장소는 루트에 package.json/src/public/api가 있는 독립 앱입니다. 이전 저장소의 web/ 경로를 다시 만들지 않습니다.

## 업로드

public/models/rubi/rubi.xml과 bundle.json은 저장소에 있습니다. XML을 수정하면 bundle.json의 XML SHA256도 검토 후 갱신해야 합니다.

```
public/models/rubi/encoder.onnx
public/models/rubi/policy.onnx
public/models/rubi/meshes/BODY.STL
public/models/rubi/meshes/L_HIP.STL
public/models/rubi/meshes/L_THIGH.STL
public/models/rubi/meshes/L_CALF.STL
public/models/rubi/meshes/L_TIP.STL
public/models/rubi/meshes/R_HIP.STL
public/models/rubi/meshes/R_THIGH.STL
public/models/rubi/meshes/R_CALF.STL
public/models/rubi/meshes/R_TIP.STL
```

ONNX는 첨부된 terrain pair 원본을 사용합니다. GitHub에서는 ZIP을 압축 해제하고 실제 파일을 해당 폴더에 올리세요. STL 9개는 현재 대화 첨부에 없으므로 추가해야 합니다. 공개된 public/ 파일은 참가자가 다운로드할 수 있습니다.

## 실행

```bash
python3 tools/check_assets.py --require-complete
python3 tools/inspect_onnx.py public/models/rubi/encoder.onnx public/models/rubi/policy.onnx
npm ci
npm test
npm run dev
```

check_assets는 hash와 기초 XML 및 누락을 검사합니다. inspect_onnx는 protobuf metadata를 읽고 추론은 하지 않습니다. 실제 파일이 준비되면 0 cm 평지에서 두 경로를 실행한 뒤 낮은 단차로 높여야 합니다. UI 높이 범위는 검증된 통과 능력을 뜻하지 않습니다.

## 배포

Settings → Pages → GitHub Actions를 설정하고 Actions → RUBI WASM Web에서 deploy를 실행합니다. Private 저장소의 Pages 사용 가능 요금제를 확인하세요. build 성공, deploy 성공, 실제 RUBI 완주, 중앙 응답 저장은 각각 다른 검증입니다.

응답 API는 api/server.mjs에 있습니다. 외부 서버에 이미 배포됐다고 가정하지 않습니다. draft의 로컬 저장은 연구자에게 자동 전송되는 것이 아닙니다.

tools/browser-smoke.mjs는 Chromium의 화면 표시와 최소 MuJoCo 물리 step, 합성 ONNX 네트워크의 추론을 검사합니다. 합성 테스트 가중치는 RUBI 원본 policy가 아니므로 이 결과를 실제 RUBI 폐루프 보행 검증으로 해석하면 안 됩니다.

현재 생성 경로는 플랫폼의 상승과 하강을 포함하고 우회거리와 회전 특성이 함께 변합니다. 본 조사 전에 CoT 구간 정렬과 변인통제를 점검하세요.
