## 다운로드

- [macOS 설치 파일 (.pkg)](https://github.com/doresh-tanakh/PPFC-Pro-Photo-Format-Converter/releases/download/v1.0.4/PPFC-1.0.4-arm64.pkg)
- [Windows 설치 파일 (.exe)](https://github.com/doresh-tanakh/PPFC-Pro-Photo-Format-Converter/releases/download/v1.0.4/PPFC.Setup.1.0.4.exe)
- [모든 릴리스와 빌드 결과](https://github.com/doresh-tanakh/PPFC-Pro-Photo-Format-Converter/releases)

# PPFC — Pro Photo Format Converter

macOS와 Windows용 로컬 이미지 일괄 변환기입니다. Electron + sharp/libvips를 사용하고 사진을 서버에 업로드하지 않습니다.

## 개발 및 패키징

최종 사용자는 Node.js를 설치할 필요가 없습니다. Electron 앱과 Node 런타임이 macOS .pkg 및 Windows .exe 설치 파일에 함께 포함됩니다. Node.js 24는 소스에서 직접 빌드할 때만 필요합니다. Electron 45 기반입니다. HEIC/HEIF 디코딩에는 libheif-js WebAssembly를 사용합니다.

```sh
npm ci
npm start
npm run dist:mac
npm run dist:win
```

GitHub Actions는 main push에서 두 설치 파일을 빌드해 아티팩트로 14일간 보관하고, v* 태그에서는 GitHub Release에 게시합니다. macOS 패키지는 macOS 러너에서, Windows 설치 파일은 Windows 러너에서 만듭니다.

## 기능

- 사진 여러 장을 한 번에 변환 (일괄 개수 제한 없음)
- JPG, PNG, WebP, AVIF, TIFF, GIF, HEIF 출력
- 변환 진행률 퍼센트 표시
- 품질 및 선택적 크기 조정
- 파일 이름 충돌 시 번호를 추가해 기존 결과를 보존
- 프린터에 사진을 넣는 형태의 PPFC 아이콘
- 모든 변환을 기기 안에서 처리

## 보안 및 포맷 참고

Electron sandbox, Context Isolation, 검증된 IPC 발신자, 전용 ppfc:// 보안 오리진, CSP, Electron 보안 퓨즈를 적용했습니다. 원격 네트워크 요청, 새 창, WebView, OS 권한 요청을 차단합니다. 입력은 200 MB, 총 픽셀은 4천만, 애니메이션은 500프레임까지 처리합니다. 이미지는 로컬에서 변환합니다.

잠금된 의존성 트리의 npm audit 취약점은 0건이며 CI에서도 전체 audit을 실행합니다. HEIC/HEIF는 WebAssembly 디코더로 처리합니다. 모든 카메라 RAW 변형과 특허 코덱 지원을 보장하지 않습니다. 설치 파일은 아직 macOS Developer ID 서명·공증 및 Windows Authenticode 서명이 없어 OS 경고가 표시될 수 있습니다.
