# 모델 연결 및 이번 단계의 완료 기준

이 저장소는 루트에 package.json/src/public/api가 있는 독립 앱입니다. 이전 저장소의 web/ 경로를 이 저장소에 다시 만들 필요가 없습니다.

## 파일 배치

```
public/models/rubi/rubi.xml
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

제공한 asset ZIP은 압축 해제 후 저장소 루트에 public 폴더를 합칩니다. GitHub Upload files에서도 같은 경로를 지키세요. ZIP 하나를 저장소에 올리는 것으로는 작동하지 않습니다.

ONNX 두 개는 사용자가 첨부한 terrain pair입니다. SHA256과 실제 tensor 정보는 MODEL_CONTRACT.md에 있습니다. XML의 배포용 복사본은 원본에서 world include/주석만 제거하며 로봇의 남은 물리 속성을 유지합니다. STL은 현재 첨부되지 않아 제공된 ZIP에도 없습니다.

## 검증

```bash
python3 tools/check_assets.py --strict
npm ci
npm test
npm run dev
```

check_assets는 shape/hash/기초 XML/누락을 검사합니다. 물리 엔진에서 모델을 컴파일하거나 실제 보행 성공을 판정하는 명령은 아닙니다. draft에서는 누락 자산이 있어도 CI가 UI를 빌드할 수 있지만 released에서는 차단합니다.

우선 0 cm 평지에서 두 경로를 실행한 후 낮은 단차로 올립니다. UI의 높이 범위는 검증된 로봇 능력을 뜻하지 않습니다.

## 배포와 데이터

public/study.json의 bundleBaseUrl=models/rubi/로 자동 모델 로딩을 켰습니다. 누락 파일이 있으면 실행되지 않으며 로컬 폴더 선택도 사용할 수 있습니다.

GitHub Pages의 Private 저장소 지원 요금제를 확인한 뒤 Settings/Pages에서 GitHub Actions를 선택하세요. Actions의 RUBI WASM Web에서 deploy를 실행합니다. 빌드 성공/공개 배포/실제 RUBI 완주/중앙 응답 저장은 각각 별도로 확인해야 합니다.

응답 API는 api/server.mjs에 있으며 아직 외부 서버에 배포됐다고 가정하지 않습니다. draft의 로컬 응답 저장은 연구자에게 자동 전송되는 것이 아닙니다.

tools/browser-smoke.mjs는 production 하위경로, 데스크톱/모바일 레이아웃, 3D canvas, 미시청 응답 차단, WASM 파일 배포를 확인합니다. 이것은 실제 RUBI ONNX의 폐루프 보행 테스트가 아닙니다.
