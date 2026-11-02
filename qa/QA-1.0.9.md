# PPFC v1.0.9 QA

Date: 2026-11-02 (Asia/Seoul)

## Changes from v1.0.8

1. Completion counts and per-file success/error results are stored independently from DOM nodes. Results survive redraws; starting a new batch clears stale results, and clearing the list resets progress.
2. AVIF input is decoded in a separate Electron utility process. Main-process native HEIF loading remains blocked. The worker accepts only AV1-compressed HEIF containers, checks file size, image dimensions and page count, and returns bounded RGBA pixels. Parent requests are serialized and time out after 30 seconds. This is crash isolation, not an OS security sandbox.
3. Unsupported HEVC/HEIF output is excluded from both the UI and the main-process output allowlist. HEIC/HEIF input remains supported. This release does not add an HEVC encoder.

## Source verification

- `results-1.0.9.json`: 61 checks PASS, 0 FAIL, using real codecs, actual filesystem output and a real Node child process for the AVIF worker; Electron IPC/window/dialog transport is mocked.
- Includes all six AVIF input conversion paths, 1,000 distinct small files, HEIC conversion, eight concurrent HEIC requests, collision-safe output, resize, malformed/revoked/modified inputs, disguised AVIF rejection, recovery, and protocol checks.
- `renderer.cjs`: mixed success/failure completion count, result retention after redraw, retry behavior and clearing progress all PASS using the production renderer source with a minimal DOM harness.
- AVIF output is independently decoded in another process, since the app's main-process native HEIF loader is intentionally blocked.
- Local npm audit could not reach registry.npmjs.org (DNS failure). CI performs npm audit before packaging.

## Packaged verification

The build workflow now runs `qa/renderer.cjs` on both operating systems. After packaging, `qa/packaged-smoke.cjs` starts the actual packaged application and invokes a CI-only smoke path. It generates an AVIF fixture, uses the actual Electron utility process, loads the actual renderer/preload/protocol, supplies deterministic file dialogs, clicks the renderer's file/folder/convert handlers, checks a JPEG output and 100%/1-success UI state, and verifies the HEIF output option is absent. macOS also requires strict signature verification and the existing 10-second startup check. Uploads are blocked if these checks fail.

Packaged CI verification: [run 41449180061](https://github.com/doresh-tanakh/PPFC-Pro-Photo-Format-Converter/actions/runs/41449180061). Both macOS and Windows passed renderer regression checks, dependency audit, and the actual packaged AVIF conversion/completion-UI smoke test. macOS also passed strict signature and startup checks.

The first packaged run, [41448781965](https://github.com/doresh-tanakh/PPFC-Pro-Photo-Format-Converter/actions/runs/41448781965), observed the UI before the queued completion IPC messages arrived. A JPEG and success row existed, but the test sampled the running status. The CI-only smoke test now waits up to five seconds for completion; the rerun passed on both OSes. The failed run is retained for auditability.

## Scope limits

The batch fixtures are 32×24 images, not 1,000 large camera originals. The tests do not establish unlimited capacity, HDR/color fidelity, all RAW variants, animated AVIF support, clean-machine installation, Intel Mac compatibility or notarization. Windows packaged tests run on GitHub's runner, not on the user's PC. No Developer ID/Authenticode identity has been added.

The previous installed v1.0.8 QA findings remain in `REPORT.md` and `results.json` for comparison.
