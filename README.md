# PPFC — Pro Photo Format Converter

macOS와 Windows용 로컬 이미지 일괄 변환기입니다. Electron + sharp/libvips를 사용하고 사진을 서버에 업로드하지 않습니다.

## 개발 및 패키징

Node.js 22.12 이상 필요. Electron 45 기반으로 구성했습니다. HEIC/HEIF 디코딩은 libheif-js WebAssembly를 사용합니다.

```sh
npm install
npm start
npm run dist:mac   # macOS .pkg 설치 파일 (macOS 호스트 필요)
npm run dist:win   # Windows NSIS .exe 설치 파일 (Windows 호스트 권장)
```

저장소의 GitHub Actions는 `main`에 push하면 macOS `.pkg`와 Windows NSIS `.exe`를 각각 빌드해 Actions 아티팩트로 14일간 보관합니다. 설치 파일은 각 OS의 GitHub 러너에서 생성됩니다. 배포 전 macOS .pkg 배포에는 Developer ID Installer 인증서와 공증이 필요합니다. Windows 설치 파일은 Authenticode 코드 서명으로 게시자 경고를 줄일 수 있습니다.

## 기능

- 다중 파일 선택 후 일괄 변환 (앱에서 설정한 개수 제한 없음, 한 장씩 처리)
- JPG, PNG, WebP, AVIF, TIFF, GIF, HEIF 출력
- 품질 및 선택적 크기 조정
- 기존 파일은 절대 덮어쓰지 않으며 이름 충돌 시 번호를 붙임
- 네트워크 연결 및 원격 코드 불필요
- 렌더러 샌드박스, Context Isolation, restrictive CSP, 제한된 IPC
- 입력 이미지 크기 상한 1억 6천만 픽셀, 파일 크기 상한 2 GB로 이미지 폭탄 위험 완화

## 포맷 지원 참고

HEIC/HEIF 입력은 libheif-js 1.23.5 WebAssembly 디코더로 처리하므로 sharp 기본 바이너리의 HEVC 지원에 의존하지 않습니다. 안전을 위해 HEIC/HEIF는 200 MB 및 4천만 픽셀 한도를 둡니다. HEIF/HEIC 출력 인코딩은 sharp/libvips에 HEVC 인코더가 필요할 수 있어 배포 전에 각 플랫폼에서 확인해야 합니다. 모든 카메라 RAW 변형/특허 코덱 지원을 보장하지 않습니다.
