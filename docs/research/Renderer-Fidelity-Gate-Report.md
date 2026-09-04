# Renderer Fidelity Gate Report

## Executive Summary

Fidelity Gate는 **통과하지 않았다**. 최종 권고는 **D. rhwp Upstream Fixes Required Before Product Expansion**이다.

자동 감사 결과, 테스트한 실제 301쪽 로컬 문서에서 본문과 표 셀의 의미 텍스트 자체는 누락되지 않았다. 본문 3,646/3,646개 문단과 의미 문자 126,788자는 모두 페이지 layout에 연결됐고 selection geometry도 존재했다. 의미 있는 표 셀 문단 4,727개도 모두 대응 visual cell block에서 원문 내용을 확인했다. raw SVG와 Lens가 정제한 SVG 사이의 의미 문자 차이는 0이었다.

따라서 사용자에게 보인 “누락”은 parser가 텍스트를 잃은 현상보다 **paint/clip/object layout 때문에 존재하는 글자가 보이지 않거나 잘려 보이는 현상**에 가깝다. 실제로 raw SVG에서 단순 clipPath를 검사한 결과, 301쪽 중 27개 페이지의 의미 있는 glyph 1,305개가 clip bottom보다 아래에 baseline을 두고 있었다. 방향은 모두 bottom이었다. 이는 표/컨트롤에서 글자 하단이 잘리거나 거칠게 보인다는 보고와 일치하는 유력한 SVG backend 후보다.

SVG는 default/regression baseline으로 유지하고 Canvas2D는 experimental 상태로 둔다. Canvas2D의 semantic mapping과 copy는 통과했지만, 대표 local document의 pixel-level A/B는 이번 환경에서 완료하지 못했다. Table/Image/Style Diff 등 신규 기능은 계속 중단한다.

## Test Environment

- OS: Windows 11 Home 64-bit, build 10.0.26200
- Node.js: 22.14.0
- npm: 10.9.2
- rhwp: `@rhwp/core@0.8.4`
- HWPX Lens: `0.0.4`, branch `codex/renderer-fidelity-gate`
- Renderer 상태: SVG default, Canvas2D experimental, CanvasKit deferred
- 실제 문서: Git에서 제외된 `local-fixture-01`이라는 익명 식별자만 사용

Node/jsdom 감사의 `measureTextWidth`는 deterministic test bridge를 사용한다. 따라서 stored layout/semantic/markup completeness 검증에는 유효하지만, 실제 Windows 글꼴 raster 품질을 대체하지 않는다.

## Corpus

공개 synthetic corpus는 28종으로 확장했다.

- Text/pagination: simple paragraph, multiline, mixed font, long paragraph, multi-page text, long document
- Table: simple, horizontal/vertical/complex merge, long table, cross-page table, multiple paragraphs in a cell, cell padding, border variations, table with image, table near page bottom, table caption surrogate
- Image: PNG, JPEG, transparent PNG, inline, floating, behind text, in front of text, picture caption, resized, cropped
- Compatibility: 기존 merged-table fixture 유지

WMF/EMF는 redistributable synthetic 파일을 만들지 않았다. 대신 실제 로컬 문서의 패키지 리소스와 public image pipeline을 익명 통계로 감사했다. 실제 문서는 Git, screenshot, report에 포함하지 않았다.

## Text Completeness

### Actual local fixture

| Metric | Result |
|---|---:|
| Pages | 301 |
| Meaningful body paragraphs | 3,646 |
| Body paragraphs mapped to layout | 3,646 |
| Paragraphs with selection geometry | 3,646 |
| Meaningful body characters | 126,788 |
| Missing layout characters | 0 |
| Raw SVG character deficit | 0 |
| Sanitizer character drift | 0 |
| Meaningful runs outside page bounds | 0 |
| Empty layout records outside page bounds | 64 |

4개의 raw layout run이 body-looking address를 가졌지만 source range와 불일치했다. 이들은 adapter가 이미 검증 후 unmapped generated/header/footer 계열로 격리하는 유형이며, 의미 있는 본문 coverage에는 영향을 주지 않았다.

### Table-cell text

| Metric | Result |
|---|---:|
| Meaningful cell paragraphs | 4,727 |
| Exact visual text match | 4,562 |
| Generated/control/formatting difference | 165 |
| Missing visual cell blocks | 0 |
| Source content missing after normalization | 0 |

165건은 visual text가 source text를 포함하면서 자동번호·필드·제어/서식 문자 때문에 exact string만 달랐다. 실제 source content가 없는 셀 문단은 발견되지 않았다.

## Missing Paragraph Patterns

의미 있는 본문 누락 pattern은 이 fixture에서 0건이었다. 초기 검사에서 52쪽, 64개의 page-right overflow가 잡혔지만 모두 빈 text run으로 확인되어 visible text defect로 분류하지 않았다.

현재 반복 pattern은 paragraph loss가 아니라 다음과 같다.

- 표/컨트롤이 많은 27개 페이지에 SVG bottom clip suspect가 집중됨
- 1,305개 meaningful glyph의 baseline이 nearest simple clip bottom보다 약 1.4~2.7 SVG unit 아래에 위치
- left/right/top clip suspect는 0
- raw SVG에는 문자가 존재하므로 DOM/text inventory 검사만으로는 시각적 clipping을 잡을 수 없음

## Pagination

Synthetic multi-page paragraph, long document, long table, table cross-page fixture는 page 생성과 body/cell text coverage를 통과했다. 실제 fixture에서도 의미 있는 run이 page top/bottom을 벗어나는 경우는 0이었다.

다만 이는 source application과 pagination이 pixel-equivalent하다는 뜻이 아니다. 대표 문서의 page break, master page, floating object reservation, table split은 reference rendering과의 A/B가 남아 있다.

## SVG Results

### Passed

- 28 synthetic fixture 모두 SVG 생성 성공
- 모든 synthetic body run이 source range에 정확히 mapping
- 대표 text/table/caption fixture에서 raw SVG character deficit 0
- 실제 fixture raw SVG character deficit 0
- SVG sanitizer text drift 0
- 실제 fixture page image 0건 blocked

### Failed / conditional

- 27개 페이지에서 1,305개의 meaningful text element가 simple clip bottom 아래 baseline을 가짐
- 실제 사용자 보고의 complex boxed-table/caption/vector image visual defect가 남음
- SVG가 글자를 한 글자씩 분리하므로 native selection/copy UX는 primary interaction 방식으로 부적합

## Canvas2D Results

### Passed

- 28 synthetic fixture에서 SVG와 page count 및 page coordinate family 일치
- 실제 fixture 301쪽 인식
- public native mapping/selection/copy 동작
- 실제 fixture sample 4쪽에서 Canvas2D page descriptor 생성
- plain text copy가 semantic range와 일치

### Not proven

- 실제 affected page의 pixel output
- SVG bottom clip suspect가 Canvas2D에서 사라지는지 여부
- 실제 표/WMF/EMF/caption이 SVG보다 좋아지는지 여부

Canvas2D는 합격도 탈락도 아니다. 실제 page paint A/B 없이 default로 승격하지 않는다.

## Table Fidelity

Synthetic table gate는 다음을 통과했다.

- row/column/cell structure
- horizontal/vertical/complex merge span
- 28x3 long table
- 55x2 cross-page table
- multiple paragraphs in cell
- per-cell padding mutation
- border variation mutation
- table-contained image
- table near page bottom
- semantic cell block coverage

그러나 실제 사용자가 보고한 일반 표 및 complex boxed-table 파손은 해결되지 않았다. Synthetic 문서는 rhwp public mutation으로 생성되어 parser 호환성이 높은 반면, 실제 한컴 문서는 더 복잡한 저장 구조와 control metadata를 가진다. 따라서 synthetic pass로 실제 table gate를 통과시키지 않는다.

Native table caption은 `@rhwp/core@0.8.4` public `attachCaptionAt()`으로 생성할 수 없었다. 현재 table-caption synthetic fixture는 명시적인 plain-text surrogate이며 native caption regression을 대체하지 않는다.

## Image Fidelity

PNG, JPEG, transparent PNG, inline/floating/front/behind, resize, crop, picture-caption synthetic fixture는 SVG payload 보존 및 sanitizer non-blocking을 통과했다.

실제 로컬 패키지는 37 BMP, 36 PNG, 18 WMF, 2 EMF, 1 JPEG 리소스를 포함한다. 사용된 public page source image key는 72개였고 `getSourceImageBytes()` 표면에서는 62 PNG와 10 SVG 변환 결과로 관찰됐다. Raw page SVG의 image data URL은 PNG/JPEG/SVG를 사용했으며 Lens sanitizer가 차단한 이미지는 0이었다.

이 결과는 “리소스가 pipeline을 통과한다”는 뜻일 뿐, 그림의 bounds/aspect ratio/vector operation이 정확하다는 뜻은 아니다.

## Caption Fidelity

- Synthetic picture caption은 생성 및 layout token 검출 성공
- 실제 fixture page text layout에서 figure/table-number 형태 token 242개 검출
- 실제 HWPX package에는 caption element 211개와 autoNum element 212개가 존재
- native table-caption synthetic fixture 생성은 public API gap 때문에 불가

Token 수가 존재한다고 실제 object relationship, numbering sequence, 위치가 정확하다고 볼 수 없다. 사용자가 보고한 그림/표 번호 문제는 미해결이다.

## WMF/EMF

실제 문서의 WMF 18개와 EMF 2개는 public rendering pipeline에서 PNG 또는 SVG로 변환된 상태로 소비된다. 현재 public source-image API만으로는 변환 후 payload를 원래 WMF/EMF identity에 안정적으로 역매핑하기 어렵다.

미지원으로 단정할 수는 없지만 fidelity 합격 증거도 없다. 사용자 관찰에서 WMF/EMF 파손이 반복됐기 때문에 Critical blocker로 유지한다. Upstream 후보에는 source type, conversion status, warnings, natural/rendered bounds metadata 제공과 redistributable regression fixture 필요성을 기록했다.

## Lens Integration Issues

다음을 확인했다.

- `.page-card`는 `overflow: visible`
- visible SVG/canvas surface는 page card 전체에 absolute inset
- page aspect ratio는 renderer viewBox/page size에서 계산
- raw SVG와 sanitized SVG의 text inventory 동일
- sanitizer가 실제 fixture image를 차단하지 않음

따라서 현재 확인된 text/image loss를 Lens CSS나 sanitizer가 만든 증거는 없다. Transparent semantic layer의 `overflow: hidden`은 interaction PoC 내부 surface에만 적용되며 visual SVG를 자르지 않는다.

## rhwp Engine Issues

확정된 shared engine failure는 아직 없다. Parser/document model/layout은 테스트한 fixture에서 body/cell content를 보존했다. 다만 실제 table/control layout과 WMF/EMF conversion은 reference A/B가 없어 shared engine 여부가 열려 있다.

## Backend-Specific Issues

SVG-specific 유력 후보는 text baseline/clipPath 불일치다. 1,305개 meaningful glyph가 simple clip bottom 아래에 놓이는 현상은 raw SVG에 이미 존재하며 Lens가 만든 것이 아니다.

Canvas2D가 동일 clip geometry를 사용하는지는 pixel A/B가 필요하다. 따라서 현재 분류는 “SVG backend 또는 SVG가 소비하는 shared cell/control clip geometry”이다.

## Fidelity Matrix

| Fixture / area | SVG | Canvas2D | Shared | Lens Integration | Result |
|---|---|---|---|---|---|
| Synthetic text/pagination | PASS | Structural PASS | No loss found | PASS | PASS |
| Actual body completeness | PASS inventory / visual issue reported | Mapping PASS, pixels pending | Layout content present | No loss found | CONDITIONAL |
| Simple synthetic table | PASS | Structural PASS | No loss found | PASS | PASS |
| Merged synthetic table | PASS | Structural PASS | No loss found | PASS | PASS |
| Synthetic table page split | PASS | Structural PASS | No loss found | PASS | PASS |
| Actual complex tables/boxes | Clip suspects | Pixel A/B pending | Possible | No loss found | FAIL |
| PNG/JPEG | PASS synthetic | Descriptor PASS | No loss found | PASS | PASS synthetic |
| WMF/EMF | Conversion emitted, fidelity unproven | Pixel A/B pending | Resource conversion possible | 0 blocked | FAIL |
| Figure caption | PASS synthetic / actual sequence unverified | Pending | Possible | No loss found | CONDITIONAL |
| Table caption | Native fixture gap / actual issue reported | Pending | Public API gap | No loss found | FAIL |

| Feature | SVG | Canvas2D | Severity |
|---|---|---|---|
| Text completeness | Semantic/raw inventory PASS; clip candidate FAIL | Semantic mapping PASS; pixels pending | Critical |
| Pagination | Synthetic PASS; actual reference pending | Structural PASS | Critical |
| Simple table | Synthetic PASS | Structural PASS | Critical |
| Merged table | Synthetic PASS | Structural PASS | Critical |
| Table page split | Synthetic PASS | Structural PASS | Critical |
| PNG/JPEG | Synthetic PASS | Descriptor only | High |
| WMF/EMF | FAIL / unproven conversion fidelity | Pending | Critical |
| Figure caption | Conditional | Pending | High |
| Table caption | FAIL / native fixture gap | Pending | Critical |

## Upstream Candidates

Ignored `prCandidates/rhwp/`에 다음을 기록했다.

- visible text clipping with complete SVG markup
- SVG text baseline below clip bottom
- native table-caption public fixture/API gap
- WMF/EMF fidelity and source-format metadata

외부 issue/PR은 생성하지 않았다.

## Remaining Blockers

1. Original screenshots를 만든 정확한 두 문서가 현재 workspace에 없어 동일 페이지 재현이 불가능하다.
2. Affected actual page의 SVG vs Canvas2D pixel A/B가 필요하다.
3. SVG clip suspect 1,305건이 실제 glyph crop과 1:1로 대응하는지 source application reference로 확인해야 한다.
4. Real complex boxed-table 구조를 재현하는 최소 공개 fixture가 필요하다.
5. WMF/EMF 각각의 redistributable regression fixture와 expected rendering이 필요하다.
6. Native table caption 생성/검증 public API가 필요하다.

## Recommendation

**D. rhwp Upstream Fixes Required Before Product Expansion**

- SVG default/regression baseline 유지
- Canvas2D experimental 유지; 실제 affected page A/B 전에는 승격 금지
- CanvasKit deferred 유지
- HTML text overlay로 시각 오류를 숨기지 않음
- Lens Core/DocumentAdapter/RenderingAdapter/InteractionAdapter/DiffAdapter 경계 유지
- Table/Image/Style Diff 및 신규 기능 계속 중단
- 실제 affected page → raw SVG/Canvas2D → clip/control bounds 순으로 최소 재현 후 upstream 수정

자동 Text Content Gate는 통과했지만 Visual Text Gate, real table/image/caption gate는 통과하지 않았다. 화면에 보이는 문서를 믿을 수 있다는 기준에 도달하기 전에는 Fidelity Gate를 완료 처리하지 않는다.
