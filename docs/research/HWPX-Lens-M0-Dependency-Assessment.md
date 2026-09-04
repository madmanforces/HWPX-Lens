# HWPX Lens M0 Dependency Assessment

조사 기준일: 2026-09-01 (Asia/Seoul)

## Executive Summary

핵심 질문에 대한 답은 다음과 같다.

> Semantic Change를 실제 렌더링된 HWPX 위치와 안정적으로 연결할 수 있는가?

**`rhwp`의 문서 모델과 좌표 API를 같은 엔진 안에서 사용하면 가능하다. 현재 공개된 `kordoc` API만으로는 안정적인 객체 단위 연결이 불가능하다.**

실제 배포물과 공개 HWPX fixture를 이용한 검증에서 `@rhwp/core@0.8.4`는 다음 흐름을 한 문서 모델 안에서 제공했다.

1. HWPX 로드
2. 문단/셀 텍스트 검색
3. `section / paragraph / charOffset / cellContext` 획득
4. `getCursorRect*()` 및 `getSelectionRects*()`로 페이지 좌표 획득
5. `renderPageSvg()`로 같은 페이지 렌더링
6. `getPageLayerTree()`의 `stableSourceKey`와 bounding box로 렌더링 소스 추적

검증한 공개 fixture에서는 표 셀 텍스트 검색 결과가 `section: 0`, 셀 경로, 문자 오프셋으로 반환되었고, 같은 범위의 selection rectangle과 페이지 0 SVG를 함께 얻었다. Layer Tree에는 `section:0/para:0/char:0/cell:...` 형태의 source key가 포함되었다.

반면 `kordoc@4.12.0`은 Semantic Diff와 SVG 렌더링을 모두 제공하지만 두 결과 사이의 공통 anchor를 공개하지 않는다.

- `IRBlock.pageNumber`는 제공될 수 있지만 HWPX layout cache가 없으면 section 근사값이다.
- `IRBlock.bbox`는 타입 주석상 PDF 전용이다.
- SVG에는 확인한 배포 버전 기준 `data-page`만 있고 paragraph/block/source 식별자는 없다.
- highlight는 문자열 검색어 기반이라 같은 문구가 여러 번 나오면 모두 강조된다.
- `HwpxSession.sourceRef()`는 section XML 문자 오프셋을 제공하지만 렌더 결과와 연결되지 않는다.

또한 `kordoc`의 npm root entry는 Node.js 전용이다. 배포된 `dist/index.js`가 최상위에서 `fs/promises`, `child_process`, `os`, `crypto`, `Buffer`를 사용하고 browser subpath export가 없다. 따라서 Tauri 2의 WebView 프런트엔드에서 현재 패키지를 직접 import할 수 없다. Node sidecar, Electron 전환, 또는 upstream browser build가 필요하다.

### 결론

- **kordoc-only M0:** Semantic과 렌더는 가능하지만 정확한 Semantic-to-Visual mapping 및 Tauri 직접 실행이 불충분하다. 비추천.
- **kordoc + rhwp M0:** 기술적으로 가능하지만 Node sidecar와 이중 파싱, 텍스트 기반 cross-engine mapping이 필요하다. M0 복잡도와 오매핑 위험이 크다. 비추천.
- **rhwp-only M0:** `@rhwp/core`의 WASM 문서 모델, 렌더링, 검색, 좌표 API를 이용하면 가장 짧고 안정적인 경로다. 추천. 단, rhwp-studio의 비교 엔진은 standalone npm API로 공개되어 있지 않아 text-only diff adapter의 재사용 방식은 별도 결정이 필요하다.

이 결론은 최초의 “kordoc 우선” 후보를 변경하는 dependency/architecture 결정이므로 구현 전에 사용자 승인이 필요하다.

## kordoc

Version: `4.12.0` (npm 및 GitHub release, 2026-08-29)

License: MIT. npm 배포물에 `LICENSE`, `NOTICE`, `THIRD_PARTY/`가 포함된다.

Maintenance: 활발함. 조사 시점 최신 release는 v4.12.0이고 release 설명상 1,570 tests 및 corpus gate 59/59 통과를 보고한다.

### Strengths

- `parse()` / `parseHwpx()`가 HWPX를 `IRBlock[]`로 정규화한다.
- XML ID, serialization, metadata가 아니라 IR을 비교하므로 동일 의미 재저장 노이즈를 상당 부분 제거할 수 있다.
- `compare()` / `diffBlocks()`는 block alignment와 paragraph/table similarity를 제공한다.
- table diff는 cell-level `CellDiff[][]`까지 제공한다.
- `renderHwpxToSvg()`가 multi-page HWPX SVG, 표, 이미지, shape, 문자열 highlight를 제공한다.
- HWPX layout cache가 유효하면 `IRBlock.pageNumber`에 실제 page number를 기록한다.
- `HwpxSession.sourceRef(blockIndex)`는 paragraph/table의 section index와 XML start offset을 제공한다.
- 프로젝트 자체와 핵심 HWPX 경로의 라이선스는 MIT 계열로 사용 가능하다.

### Weaknesses

- npm root entry가 Node.js 전용이며 browser/Tauri WebView entry가 없다.
- 패키지 root import가 HWPX에 불필요한 HWP/PDF/MCP/form 기능과 Node built-in 참조를 함께 끌어온다.
- IR과 SVG 사이에 공통 paragraph/block/source ID가 없다.
- HWPX block bbox는 없다. `BoundingBox`는 PDF 전용으로 문서화되어 있다.
- SVG의 텍스트는 run/style 경계로 분할되며 source metadata가 없다.
- `highlights`는 특정 change anchor가 아니라 모든 문자열 occurrence를 칠한다.
- 공개 `BlockDiff`에는 before/after block index나 inline character range가 없다.
- source map은 XML offset까지만 제공하고 page/coordinate로 이어지지 않는다.

### Useful APIs

- `parse(input, options?)`
- `parseHwpx(buffer, options?)`
- `compare(bufferA, bufferB, options?)`
- `diffBlocks(blocksA, blocksB)`
- `IRBlock`, `IRTable`, `IRCell`
- `BlockDiff`, `CellDiff`, `DiffResult`
- `renderHwpxToSvg(buffer, options?)`
- `openHwpxDocument(bytes)` / `HwpxSession.sourceRef(blockIndex)`
- `scanSectionXml()`

### Missing APIs

- Browser-safe HWPX-only package export
- Diff result의 stable block index / source ref
- SVG element의 source block/paragraph/cell metadata
- HWPX IR block bounding box
- 특정 occurrence/range만 강조하는 API
- diff inline range의 public export

### Browser, Tauri, Offline

- Offline Node 실행은 가능하다.
- 현재 npm root package를 Tauri WebView에서 직접 실행하는 것은 불가능하다.
- Tauri에 사용하려면 다음 중 하나가 필요하다.
  - Node/Bun 기반 sidecar를 애플리케이션에 번들
  - Electron으로 shell 변경
  - kordoc browser-safe subpath를 upstream에 추가
  - HWPX 관련 소스만 별도 fork/build
- 어느 옵션도 M0에서 “dependency 최소화”와 동시에 만족되지는 않는다.

### License Notes

`kordoc` 본체는 MIT이지만 기본 `npm install`은 optional dependency도 설치하려 시도한다. optional image/OCR 계열에는 LGPL 라이선스 native package와 YOLOv8/AGPL 관련 검토 안내가 포함되어 있다.

M0에서 kordoc을 사용한다면 반드시 다음 제한이 필요하다.

- `--omit=optional`
- PDF/OCR/formula model 비활성화
- 실제 packaged artifact의 SBOM/license 재검증
- kordoc `NOTICE`와 필요한 third-party notices 포함

현재는 dependency를 추가하지 않는다.

## rhwp

Version: `0.8.4` (`@rhwp/core`, npm 및 GitHub release, 2026-08-12)

License: MIT. Rust dependency 목록은 프로젝트의 `THIRD_PARTY_LICENSES.md` 기준 permissive 계열이다. Open font는 별도 OFL/GUST 계열 고지가 필요하다.

Maintenance: 매우 활발함. 안정 release는 v0.8.4이고, `devel` branch는 조사 당일에도 merge가 계속되었다. Pre-1.0이며 API churn 가능성이 높다.

Package size: npm unpacked 약 8.67 MB. 그중 `rhwp_bg.wasm` 약 8.04 MB.

### Strengths

- HWP/HWPX를 Rust + WASM으로 브라우저에서 직접 파싱한다.
- `renderPageSvg(page)`와 page-by-page rendering을 제공한다.
- `pageCount()`, `getPageInfo()`, `getPageRenderTree()`, `getPageLayerTree()`를 제공한다.
- `searchAllText()` / `searchText()`가 section, paragraph, char offset을 반환한다.
- 표 셀 match에 `cellContext`가 포함된다.
- `getCursorRect*()`와 `getSelectionRects*()`가 page index와 정확한 rectangle을 반환한다.
- `getPageLayerTree()` 텍스트 op가 bbox, source span, `stableSourceKey`를 포함한다.
- paragraph/table/image/shape layout 조회 API가 넓다.
- WASM과 JS glue가 npm package에 포함되어 offline bundling 가능하다.
- rhwp-studio 소스에 이미 외부 문서 paragraph alignment, inline text diff, control diff, anchor, two-pane compare UI가 존재한다.

### Weaknesses

- pre-1.0이라 JSON schema와 WASM API가 변경될 가능성이 있다.
- 핵심 API 다수가 typed object가 아니라 JSON string을 반환한다.
- `rhwp-studio` compare engine은 `@rhwp/core`의 public standalone API가 아니다.
- `@rhwp/editor`는 기본적으로 remote GitHub Pages iframe을 사용하고 full editor이므로 HWPX Lens의 offline/non-goal에 맞지 않는다.
- `@rhwp/core`는 문서 폰트를 함께 번들하지 않는다. Hancom Office가 없는 PC에서는 대체 폰트 때문에 pagination/line wrapping이 달라질 수 있다.
- 브라우저 text measurement를 위해 `measureTextWidth` 연결이 필요하다.
- main-thread WASM layout은 긴 문서에서 UI를 막을 수 있으므로 향후 worker/virtualization 검토가 필요하다.

### Useful APIs

- `new HwpDocument(Uint8Array)`
- `pageCount()`
- `renderPageSvg(page)`
- `getDocumentInfo()`
- `getSectionCount()` / `getParagraphCount()` / `getParagraphLength()`
- `getTextRange()` / `getTextFileUnicode()`
- `searchAllText()` / `searchText()`
- `getCursorRect()` / `getCursorRectInCell()` / `getCursorRectByPath()`
- `getSelectionRects()` / `getSelectionRectsInCell()` / `getSelectionRectsInCellByPath()`
- `getPageInfo()` / `getPageTextLayout()`
- `getPageRenderTree()` / `getPageLayerTree()`
- `getPageControlLayout()` / `getTableBBox()` / `getTableCellBboxes()`
- `getControlImageData()`

### Missing APIs

- `@rhwp/core`에서 직접 호출 가능한 headless `compareDocuments()`
- compare snapshot/diff types의 stable npm export
- compare engine과 core version의 명시적 compatibility contract
- local-only viewer package that is smaller than the full editor but richer than the raw core

### Browser, Tauri, Offline

- Browser/WASM이 정식 사용 경로다.
- Tauri WebView에서도 원칙적으로 사용 가능하다.
- WASM을 app asset으로 복사하고 로컬 URL 또는 bytes로 초기화해야 한다.
- 외부 URL fetch가 필요하지 않다.
- CSP, WASM load URL, font asset path는 Tauri integration spike에서 확인해야 한다.

## kordoc-only Feasibility

판정: **M0 권장안으로는 부적합**

가능한 부분:

- Semantic paragraph/table diff
- HWPX SVG rendering
- page-level scrolling
- 문자열 기반 전체 occurrence highlight

부족한 부분:

- 특정 semantic object를 특정 SVG object에 연결하는 공통 ID
- HWPX block coordinate
- 중복 텍스트 disambiguation
- Tauri WebView 직접 실행

따라서 “변경 목록 클릭 → 양쪽 정확한 위치 → 해당 occurrence만 highlight”는 heuristic DOM text matching 없이는 구현할 수 없다. 이 방식은 HWPX Lens의 핵심 위험을 해소하지 못한다.

## kordoc + rhwp Feasibility

판정: **가능하지만 M0 비추천**

예상 흐름:

1. kordoc sidecar에서 `IRBlock[]` 및 `BlockDiff[]` 생성
2. rhwp WASM에서 같은 두 파일을 다시 파싱
3. 변경 block의 text fingerprint와 주변 문맥을 rhwp `searchAllText()` 결과에 매칭
4. page/paragraph 순서와 context score로 occurrence 선택
5. rhwp `getSelectionRects*()`로 highlight rect 생성

문제:

- 두 parser의 text normalization과 table/control flattening이 다를 수 있다.
- 반복 문구와 짧은 문단에서 mapping confidence가 낮아진다.
- 파일을 두 번 파싱하고 두 런타임을 유지한다.
- Tauri에 Node-compatible kordoc sidecar를 추가해야 한다.
- sidecar packaging, IPC, crash handling, license artifact가 추가된다.

Adapter 내부에 격리하면 장기 fallback으로는 가능하지만, M0의 가장 짧은 검증 경로는 아니다.

## Semantic-to-Visual Mapping Feasibility

### Recommended Mapping

rhwp document model을 semantic snapshot과 rendering source의 공통 좌표계로 사용한다.

```text
HWPX bytes
  -> RhwpDocumentSession
      -> paragraph snapshots (section/paragraph/text/fingerprint)
      -> text alignment -> Change
      -> DocumentAnchor(section/paragraph/char range/cell path)
      -> getSelectionRects*()
      -> page index + rectangles
      -> renderPageSvg(page)
      -> overlay highlight
```

이 구조는 XML ID에 의존하지 않는다. Original과 Modified 사이의 동일 객체 판정은 normalized text fingerprint, 주변 문단, 상대 순서, section 구조로 수행하고, 각 문서 내부의 visual location은 rhwp model coordinate로 직접 해결한다.

### Confidence

- 동일 문단 수정: 높음
- 문단 추가/삭제: 한쪽 anchor + 반대쪽 인접 context anchor 사용, 중간~높음
- 반복되는 짧은 문단: 낮을 수 있음. 양옆 context와 상대 순서 필요
- 빈 문단: 인접 anchor fallback 필요
- 표 셀: rhwp API는 가능하지만 M0 범위에서는 비활성화 권장
- text box/footnote/header/footer: M0 범위 밖. 별도 adapter path 필요

## Recommended Architecture

### Recommendation

M0는 `@rhwp/core@0.8.4` 하나로 시작한다.

- `RhwpRenderingAdapter`
- `RhwpTextDiffAdapter`
- `RhwpDocumentSession` 내부에서 WASM document lifetime 관리
- UI는 adapter API만 호출
- exact version pin + adapter contract tests
- kordoc dependency는 추가하지 않음

rhwp-studio의 compare engine은 MIT source이지만 standalone package가 아니다. M0 text-only adapter는 다음 중 하나를 사용자 승인 후 선택한다.

1. rhwp-studio compare engine의 text alignment 부분을 attribution과 함께 adapter 내부에 최소 범위로 이식
2. 별도 headless compare API를 upstream에 제안하고 그동안 매우 제한된 PoC matcher만 유지
3. kordoc browser entry가 나오면 `KordocDiffAdapter`로 교체

권장 순서는 2 + 제한된 M0 matcher이다. M0 범위를 body paragraph text로 제한하고, table/image/style/control diff는 활성화하지 않는다.

## Recommended Dependencies

승인 시 M0 최소 dependency 후보:

- Desktop: Tauri 2
- Frontend: React, TypeScript, Vite
- Rendering/model/location: `@rhwp/core@0.8.4` exact pin
- Unit/integration: Vitest
- E2E: Playwright

보류:

- `kordoc`
- `@rhwp/editor`
- `hwpxjs`
- CanvasKit
- PDF/OCR/image diff packages
- diff utility package

## Repository Structure

초기 권장 구조를 유지하되 adapter package 이름은 generic하게 둔다.

```text
apps/
  desktop/
packages/
  lens-core/
  hwpx-adapter/
  lens-ui/
fixtures/
tests/
docs/
prCandidates/       # ignored
meetingForGpt/      # ignored
local-fixtures/     # ignored
private/            # ignored
```

`packages/hwpx-adapter` 안에서 rhwp 세부 구현을 숨긴다. 장래 `KordocDiffAdapter`를 추가해도 UI와 Lens Core는 변경하지 않는다.

## Data Flow

```text
Original File ----> Original RhwpDocumentSession ----> Original Snapshot
                                                      |
                                                      +--> Text Alignment --> Change[]
                                                      |
Modified File ----> Modified RhwpDocumentSession ----> Modified Snapshot

Change.originalAnchor --> resolveVisualTarget() --> page + rects --> Original overlay
Change.modifiedAnchor --> resolveVisualTarget() --> page + rects --> Modified overlay
```

렌더링은 page 단위로 lazy하게 수행한다. Change 선택 시 대상 페이지를 우선 렌더하고 scroll한 뒤 overlay를 표시한다.

## Core Interfaces

```ts
type Side = "original" | "modified";

interface TextRange {
  start: number;
  end: number;
}

interface CellPathEntry {
  controlIndex: number;
  cellIndex: number;
  cellParaIndex: number;
}

interface DocumentAnchor {
  engine: "rhwp";
  section: number;
  paragraph: number;
  textRange?: TextRange;
  cellPath?: CellPathEntry[];
  textFingerprint?: string;
  contextFingerprint?: string;
  confidence: "exact" | "contextual" | "approximate";
}

interface VisualRect {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface VisualTarget {
  pageIndex: number;
  rects: VisualRect[];
}

interface Change {
  id: string;
  type: "text";
  kind: "added" | "removed" | "modified";
  originalText?: string;
  modifiedText?: string;
  originalAnchor?: DocumentAnchor;
  modifiedAnchor?: DocumentAnchor;
  originalContextAnchor?: DocumentAnchor;
  modifiedContextAnchor?: DocumentAnchor;
}

interface DiffAdapter {
  compare(original: DocumentSnapshot, modified: DocumentSnapshot): Promise<Change[]>;
}

interface RenderingAdapter {
  pageCount(): number;
  renderPage(pageIndex: number): Promise<string>;
  resolveVisualTarget(anchor: DocumentAnchor): Promise<VisualTarget>;
  dispose(): void;
}
```

## UI Structure

```text
AppShell
  FileDropZone / file selectors
  CompareWorkspace
    ChangesPanel
      count + current index
      enabled filter: Text
      Previous / Next
    OriginalViewer
      PageViewport
      HighlightOverlay
    ModifiedViewer
      PageViewport
      HighlightOverlay
```

비활성 filter는 Table/Image/Style로 표시할 수 있지만 클릭 가능하게 만들지 않는다.

## Test Strategy

### Unit

- whitespace/serialization noise normalization
- exact same snapshots -> no changes
- `전원을 끈다.` -> `전원을 차단한다.` -> one modified text change
- insert/remove/modify alignment
- repeated short paragraph ambiguity
- added/removed context anchor selection
- change ordering and previous/next state

### Adapter Contract

- public synthetic HWPX load
- page count > 0
- page SVG generated
- body paragraph search/path extraction
- `getSelectionRects*()` returns non-empty rect for changed range
- page/rect coordinates remain within page bounds
- WASM dispose and repeated document switching

### Integration

- two synthetic fixtures differing by one body paragraph
- multiple pages with page number shifts
- duplicate text with unique neighboring paragraphs
- layout cache present / absent
- missing font fallback warning behavior

### E2E

- file select and drag/drop
- click change -> both viewers navigate
- both highlights visible
- previous/next and current index
- no network requests in packaged/offline test
- no private/local fixture path in build artifact

## Risks

1. **Dependency direction change**: initial kordoc-first assumption changes to rhwp-only M0.
2. **rhwp pre-1.0 API churn**: exact pin, adapter isolation, contract tests required.
3. **Compare engine availability**: rich compare implementation exists only in rhwp-studio source, not a stable npm API.
4. **Font fidelity**: Hancom fonts absent on target machines can change wrapping and pagination. Redistributable fonts and attribution policy are needed.
5. **Duplicate text**: cross-document matching must use context/order, not text alone.
6. **Added/removed changes**: one side has no direct range; neighbor context anchor required.
7. **Untrusted SVG/document input**: generated SVG insertion must be reviewed for script/external-resource injection and CSP hardened.
8. **Main-thread layout cost**: large documents may freeze. Page lazy rendering first; worker/virtualization only after correctness data.
9. **HWPX layout cache absence**: re-pagination quality depends on fonts and rhwp layout behavior.
10. **Product overlap**: rhwp-studio already implements significant document compare behavior, so HWPX Lens must remain a focused compare/review product rather than duplicate an editor.

## Existing OSS Overlap

### kordoc overlap

- HWPX parsing
- normalized IR
- paragraph/table diff
- cell diff
- SVG rendering
- string highlight

### rhwp overlap

- HWPX parsing and pagination
- SVG/Canvas rendering
- source-aware page coordinates
- selection rectangles and hit testing
- document search
- paragraph alignment and inline diff in rhwp-studio
- table/image/shape/control diff in rhwp-studio
- compare result list and two-pane compare window in rhwp-studio

### HWPX Lens independent value

- standalone compare-only desktop workflow
- Original/Modified always-visible review layout
- change-centric navigation and review state
- adapter-isolated engine usage
- offline packaged Windows UX
- strict focus on Compare -> Locate -> Review
- long-document change triage quality

독자성의 중심은 parser/diff algorithm이 아니라 **전용 review UX, packaging, reliability, and engine-independent mapping contract**에 두어야 한다.

## PR Candidates

로컬 `prCandidates/`에 다음 후보를 기록했다.

- kordoc browser-safe HWPX-only entrypoint
- kordoc SVG source anchor metadata
- rhwp headless compare package/API
- rhwp LayerTextRunOp `source` type/schema mismatch

외부 issue/PR은 생성하지 않았다.

## Topics for GPT

로컬 `meetingForGpt/dependency/2026-09-01-m0-engine-selection.md`에 다음 결정을 기록했다.

1. M0를 rhwp-only로 진행하고 kordoc을 보류할지
2. rhwp-studio compare source의 재사용 방식을 어떻게 할지
3. kordoc을 유지해야 한다면 Tauri sidecar, Electron, upstream browser entry 중 무엇을 선택할지

## Proposed M0 Implementation Plan

사용자 승인 후 다음 작은 단위로 진행한다.

### M0.1 Repository bootstrap

- workspace/package manager 결정
- Tauri 2 + React + TypeScript + Vite bootstrap
- MIT project license, NOTICE skeleton
- mandatory ignore rules and local directory check

### M0.2 rhwp WASM integration spike

- exact `@rhwp/core@0.8.4` pin
- local WASM asset loading
- `measureTextWidth` bridge
- one public synthetic HWPX load/render
- Tauri dev and packaged offline verification

### M0.3 Adapter contracts and document sessions

- Lens Core types
- `RhwpDocumentSession`
- `RhwpRenderingAdapter`
- resource disposal and load errors

### M0.4 HWPX file loading

- Original/Modified file picker
- drag/drop
- extension/MIME/magic validation
- private file names not logged persistently

### M0.5 Side-by-side rendering

- page components
- lazy page render
- independent scroll containers
- loading/error/empty states

### M0.6 Semantic text diff

- body paragraph snapshots only
- normalization and alignment
- `Change[]`
- no table/image/style changes
- no-change resave regression fixture

### M0.7 Semantic-to-visual mapping

- paragraph and character range anchors
- `getSelectionRects()` mapping
- added/removed neighbor context anchors
- duplicate text confidence handling

### M0.8 Navigation and highlight

- Changes panel
- click -> both viewers
- previous/next
- current index
- overlay highlight and active change styling

### M0.9 Offline/security verification

- block/observe all network requests
- CSP
- SVG/resource safety checks
- bundled WASM/font/license audit

### M0.10 Regression and E2E

- synthetic fixtures
- unit, adapter, integration, E2E
- packaged Windows smoke test
- ignored local directory/staged file audit

## Sources

- [kordoc repository](https://github.com/chrisryugj/kordoc)
- [kordoc v4.12.0 release](https://github.com/chrisryugj/kordoc/releases/tag/v4.12.0)
- [kordoc API README](https://github.com/chrisryugj/kordoc/blob/main/README-EN.md)
- [kordoc IR and diff types](https://github.com/chrisryugj/kordoc/blob/main/src/types.ts)
- [kordoc compare implementation](https://github.com/chrisryugj/kordoc/blob/main/src/diff/compare.ts)
- [kordoc SVG renderer](https://github.com/chrisryugj/kordoc/blob/main/src/render/svg-render.ts)
- [kordoc package metadata](https://github.com/chrisryugj/kordoc/blob/main/package.json)
- [kordoc NOTICE](https://github.com/chrisryugj/kordoc/blob/main/NOTICE)
- [rhwp repository](https://github.com/edwardkim/rhwp)
- [rhwp v0.8.4 release](https://github.com/edwardkim/rhwp/releases/tag/v0.8.4)
- [rhwp WASM API](https://github.com/edwardkim/rhwp/blob/main/src/wasm_api.rs)
- [rhwp npm core README](https://github.com/edwardkim/rhwp/blob/main/npm/README.md)
- [rhwp page layer JSON/source key implementation](https://github.com/edwardkim/rhwp/blob/main/src/paint/json.rs)
- [rhwp-studio compare engine](https://github.com/edwardkim/rhwp/blob/main/rhwp-studio/src/compare/diff-engine.ts)
- [rhwp-studio compare types](https://github.com/edwardkim/rhwp/blob/main/rhwp-studio/src/compare/types.ts)
- [rhwp third-party licenses](https://github.com/edwardkim/rhwp/blob/main/THIRD_PARTY_LICENSES.md)

