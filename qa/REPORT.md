# PPFC v1.0.8 QA — 2026-11-02

Overall result: FAIL. Core macOS HEIC conversion works, but three functional defects remain.

## Scope and evidence

- Installed `/Applications/PPFC.app` version 1.0.8. `codesign --verify --deep --strict` passed.
- Opened the installed application through native UI automation. Selected the HEIC fixture, selected the dedicated QA output folder, and clicked Convert.
- Confirmed a real JPEG file was created: `qa/gui-output/ppfc-fixture.jpg`, 1280×854, 361593 bytes.
- Extracted the installed app.asar to a temporary directory. Ran the actual packaged main-process conversion handlers with the bundled native/WASM codecs and actual filesystem writes; only Electron window/dialog/IPC transport was mocked. This is integration coverage, not a full GUI end-to-end test for every format.
- The packaged main, preload, renderer and HEIF decoder sources match the workspace sources; see `gui-evidence.json`.
- Automated suite: 60 checks, 53 PASS / 7 FAIL. Six failures share the AVIF input defect; one is HEIF output.
- Reproduced the separate completion-count defect in the actual installed GUI.

## Confirmed defects

### 1. Completion screen loses results and reports zero successes

Reproduction: select a valid HEIC; convert to JPG; wait for 100%. The JPEG is created, but the screen says `완료 · 0장 변환됨` and the per-file success row disappears.

Cause: renderer `onDone` calls `render()` before counting `.result` nodes. `render()` recreates the result nodes without their previous values. The existing `results` Map is never populated. Re-rendering after list changes similarly loses prior results.

### 2. Valid AVIF inputs are rejected

Generated a valid AVIF using the bundled encoder and passed it through every advertised output format (JPG, PNG, WebP, AVIF, TIFF, GIF). All six fail with `Input buffer contains unsupported image format`.

Cause: the app blocks `VipsForeignLoadHeif` globally, which also blocks the AVIF input loader. The WASM input branch recognizes HEIC/HEIF/HIF extensions only, so AVIF gets no alternative decoder.

AVIF export itself works: seven AVIF output files were independently decoded in a fresh sharp process without the app's global input-loader restriction. The test harness uses independent validation for AVIF to avoid falsely reporting the app's input restriction as corrupt output.

### 3. HEIF output is selectable but not supported by the bundled encoder

PNG→HEIF fails with the codec-unavailable message. The app always includes HEIF in its output format list, and the renderer does not disable it based on encoder capability. The test confirms this on the installed macOS build; Windows encoder behavior was not exercised.

## Passed checks

- JPEG, PNG, WebP, TIFF, GIF, HEIC and SVG inputs to the six other output formats: 42 combinations passed, including independent AVIF output decoding.
- 1,000 distinct small PNG files queued and converted to 1,000 JPEG files; progress events were monotonic and ended at 100%.
- A separate earlier batch with 1,000 repeated queue entries passed. Same-name collisions are slow because suffix search restarts at zero for each file; this is not a throughput benchmark for large camera images.
- Eight concurrent HEIC conversion requests all produced successful outputs.
- Existing output file preservation, resize, invalid dimensions, temporary directory cleanup, unapproved/revoked/modified inputs, untrusted IPC sender rejection, corrupt-file recovery, and static protocol allowlist checks passed.

## Limits

- The 1,000-file test uses small 32×24 images. It does not prove unlimited processing, large-image throughput, or bounded whole-app memory at arbitrarily large file counts.
- Windows installation/launch/conversion, Intel Mac support, a clean second Mac, HDR/color fidelity, EXIF orientation, ICC profiles, multipage images/animations, RAW variants and accessibility were not fully validated here.
- The installed app has an ad-hoc signature, not Developer ID signing/notarization. Passing codesign integrity verification does not establish publisher identity or guarantee Gatekeeper acceptance on another Mac.
- This QA run did not modify application code, publish a new release, or change existing installers.

## Artifacts

- `run.cjs`: repeatable integration harness, requires an extracted installed app path in `/private/tmp/ppfc-qa108-path` and the HEIC fixture.
- `results.json`: current 1,000-distinct-file run.
- `results-collision.json`: earlier repeated-name batch and independently validated AVIF results.
- `gui-evidence.json`: native UI observation and source comparison.
- `gui-output/ppfc-fixture.jpg`: JPEG produced by the installed GUI.
