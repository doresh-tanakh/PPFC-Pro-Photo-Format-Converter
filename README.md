# PPFC — Pro Photo Format Converter

## 다운로드

- [macOS 설치 파일 (.pkg)](https://github.com/doresh-tanakh/PPFC-Pro-Photo-Format-Converter/actions/runs/41439226673/artifacts/13138590049)
- [Windows 설치 파일 (.exe)](https://github.com/doresh-tanakh/PPFC-Pro-Photo-Format-Converter/actions/runs/41439226673/artifacts/13137543365)
- [모든 릴리스와 빌드 결과](https://github.com/doresh-tanakh/PPFC-Pro-Photo-Format-Converter/actions/workflows/build-installers.yml)\n\nActions 설치 파일은 ZIP 아티팩트로 제공되며 14일 후 만료됩니다.

macOS와 Windows용 로컬 이미지 일괄 변환기입니다. Electron + sharp/libvips를 사용하고 사진을 서버에 업로드하지 않습니다.

## 개발 및 패키징

최종 사용자는 Node.js를 설치할 필요가 없습니다. Electron 앱과 Node 런타임이 macOS `.pkg` 및 Windows `.exe` 설치 파일에 함께 포함됩니다. Node.js 24는 소스에서 직접 빌드할 때만 필요합니다. Electron 45 기반으로 구성했습니다. HEIC/HEIF 디코딩은 libheif-js WebAssembly를 사용합니다.

```sh
npm ci
npm start
npm run dist:mac   # macOS .pkg 설치 파일 (macOS 호스트 필요)
npm run dist:win   # Windows NSIS .exe 설치 파일 (Windows 호스트 권장)
```

저장소의 GitHub Actions는 `main`에 push하면 macOS `.pkg`와 Windows NSIS `.exe`를 각각 빌드해 Actions 아티팩트로 14일간 보관합니다. `v*` 태그를 push하면 동일한 빌드를 GitHub Release에 영구 자산으로 게시합니다. 설치 파일은 각 OS의 GitHub 러너에서 생성됩니다. 배포 전 macOS .pkg 배포에는 Developer ID Installer 인증서와 공증이 필요합니다. Windows 설치 파일은 Authenticode 코드 서명으로 게시자 경고를 줄일 수 있습니다.

## 기능

- 다중 파일 선택 후 일괄 변환 (앱에서 설정한 개수 제한 없음, 한 장씩 처리)
- JPG, PNG, WebP, AVIF, TIFF, GIF, HEIF 출력
- 사진이 프린터로 들어가는 PPFC 앱 아이콘
- HEIC/HEIF 일괄 처리 시 WebAssembly 디코더를 재사용해 반복 변환 중 메모리 누적 방지
- 선택 해제된 파일의 승인 토큰 회수 및 동일 파일 재선택 시 토큰 재사용
- HEIF 이미지 수를 개별 이미지 핸들 할당 전에 검사해 대량 항목 파일의 메모리 사용 제한
- HEIF 동시 변환 요청을 직렬화해 공유 WASM 디코더 컨텍스트 충돌 방지
- 여러 사진을 변환할 때 완료 수와 진행률 퍼센트 표시
- 품질 및 선택적 크기 조정
- 기존 파일은 절대 덮어쓰지 않으며 이름 충돌 시 번호를 붙임
- 네트워크 연결 및 원격 코드 불필요
- 렌더러 샌드박스, Context Isolation, restrictive CSP, 제한된 IPC
- renderer에서 원격 네트워크, 새 창, WebView, OS 권한 요청 차단
- 입력 파일 크기 200 MB, 전체 이미지 프레임 합계 4천만 픽셀, 애니메이션 500프레임 상한으로 자원 고갈 위험 완화
- 기존 출력 파일을 덮어쓰지 않고 임시 파일을 같은 폴더에서 안전하게 생성
- `ppfc://` 보안 오리진, 응답 CSP, Electron sandbox 및 검증된 IPC 발신자, 파일별 임의 승인 토큰
- npm lockfile과 CI의 전체 의존성 audit, Electron 보안 퓨즈 및 Dependabot 업데이트 확인

## 포맷 지원 참고

HEIC/HEIF 입력은 libheif-js 1.23.5 WebAssembly 디코더로 처리하므로 sharp 기본 바이너리의 HEVC 지원에 의존하지 않습니다. 안전을 위해 HEIC/HEIF는 200 MB 및 4천만 픽셀 한도를 둡니다. HEIF/HEIC 출력 인코딩은 sharp/libvips에 HEVC 인코더가 필요할 수 있어 배포 전에 각 플랫폼에서 확인해야 합니다. 모든 카메라 RAW 변형/특허 코덱 지원을 보장하지 않습니다.

## 배포 보안 참고

현재 잠금된 전체 의존성 트리에서 `npm audit` 취약점은 0건입니다. CI도 설치 과정에서 lockfile을 검증하고 전체 의존성 감사를 통과해야 패키징합니다. 입력 이미지는 로컬에서 처리하며 네트워크 요청을 차단합니다. 지원되지 않는 형식과 RAW 변형, 손상 파일, 일부 특허 코덱을 모두 처리한다고 보장하지 않습니다. macOS Developer ID 서명·공증과 Windows Authenticode 서명은 아직 적용되지 않아, 현재 설치 파일은 운영체제 경고가 표시될 수 있습니다.
