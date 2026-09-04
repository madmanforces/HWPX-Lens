import { HwpDocument } from "@rhwp/core";
import {
  createTableSnapshot,
  createParagraphSnapshot,
  sha256Hex,
  type DocumentAnchor,
  type DocumentComplexityProfile,
  type DocumentSnapshot,
  type ImageSnapshot,
  type LensDocument,
  type InteractionAdapter,
  type PageSize,
  type RenderedPage,
  type RenderingAdapter,
  type VisualRect,
  type VisualTarget,
} from "@hwpx-lens/lens-core";
import { ensureRhwpInitialized } from "./rhwp-runtime";
import { sanitizeRenderedSvg } from "./svg-safety";
import { RhwpSemanticInteractionAdapter } from "./rhwp-semantic-interaction-adapter";
import { RhwpNativeInteractionAdapter } from "./rhwp-native-interaction-adapter";
import {
  extractImageCaptionMetadata,
  imageStableIndexKey,
  type ImageCaptionMetadata,
} from "./rhwp-image-caption-metadata";

interface RhwpPageInfo {
  width: number;
  height: number;
}

interface RhwpControlInfo {
  ctrlId?: unknown;
  list?: unknown;
  para?: unknown;
  controlIndex?: unknown;
}

interface RhwpImageControlLayout {
  type?: unknown;
  x?: unknown;
  y?: unknown;
  w?: unknown;
  h?: unknown;
  secIdx?: unknown;
  paraIdx?: unknown;
  controlIdx?: unknown;
  cellPath?: unknown;
  stableIndex?: unknown;
}

interface RhwpPageControlLayout {
  controls?: unknown;
}

interface RhwpFlowImageOp {
  bbox?: unknown;
  mime?: unknown;
  sourceImageKey?: unknown;
  crop?: unknown;
  originalSizeHu?: unknown;
  effect?: unknown;
  brightness?: unknown;
  contrast?: unknown;
  transform?: unknown;
}

interface RhwpPageFlowImageOps {
  images?: unknown;
}

interface RhwpPictureProperties {
  hasCaption?: unknown;
}

interface RhwpCursorListInfo {
  listId?: unknown;
  hostListId?: unknown;
  sectionIndex?: unknown;
  hostPara?: unknown;
  controlIndex?: unknown;
  cellIndex?: unknown;
}

interface RhwpCursorModel {
  lists?: unknown;
}

interface RhwpCellPathEntry {
  controlIndex: number;
  cellIndex: number;
  cellParaIndex: number;
}

interface RhwpTableAddress {
  tableIndex: number;
  sectionIndex: number;
  paragraphIndex: number;
  controlIndex: number;
  direct: boolean;
  path: RhwpCellPathEntry[];
  pathJson: string;
}

interface RhwpTableDimensions {
  rowCount: number;
  colCount: number;
  cellCount: number;
}

interface RhwpCellInfo {
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
}

interface RhwpTableCellBBox {
  cellIdx: number;
  pageIndex: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface RhwpBBox {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RhwpOutlineEntry {
  level?: unknown;
  number?: unknown;
  page?: unknown;
  section?: unknown;
  paragraph?: unknown;
}

interface RhwpOutlineNavigation {
  outline?: unknown;
}

const MAX_TABLE_COUNT = 10_000;
const MAX_CELLS_PER_TABLE = 20_000;
const MAX_TOTAL_CELL_COUNT = 250_000;
const MAX_PARAGRAPHS_PER_CELL = 10_000;
const RHWP_ANALYSIS_IDENTITY = "@rhwp/core@0.8.6:lens-snapshot-v5-image-caption-classification";
let nextRenderingSessionId = 0;

/** Owns one public @rhwp/core document without leaking it across the adapter. */
class RhwpDocumentSession {
  private disposed = false;
  private readonly tableAddresses = new Map<number, RhwpTableAddress>();
  private readonly svgIdNamespace = `hwpx-lens-document-${++nextRenderingSessionId}`;
  private profile?: DocumentComplexityProfile;

  constructor(
    private readonly document: HwpDocument,
    private readonly compressedBytes: number,
    private readonly imageCaptionMetadata: ReadonlyMap<string, ImageCaptionMetadata>,
  ) {}

  async createSnapshot(): Promise<DocumentSnapshot> {
    this.assertOpen();
    const paragraphs: DocumentSnapshot["paragraphs"] = [];
    const outlines = this.getOutlineMap();
    const sectionCount = this.document.getSectionCount();
    let paragraphCount = 0;

    for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex += 1) {
      const sectionParagraphCount = this.document.getParagraphCount(sectionIndex);
      paragraphCount += sectionParagraphCount;
      for (let paragraphIndex = 0; paragraphIndex < sectionParagraphCount; paragraphIndex += 1) {
        const length = this.document.getParagraphLength(sectionIndex, paragraphIndex);
        const text = this.document.getTextRange(sectionIndex, paragraphIndex, 0, length);
        const snapshot = createParagraphSnapshot(sectionIndex, paragraphIndex, text);
        if (snapshot) {
          const outline = outlines.get(`${sectionIndex}:${paragraphIndex}`);
          paragraphs.push(outline ? {
            ...snapshot,
            outline,
            alignmentText: `${outline.level}:${outline.number}:${snapshot.normalizedText}`,
            alignmentIdentity: `${outline.level}:${snapshot.normalizedText}`,
          } : snapshot);
        }
      }
    }

    const controls = parseJson<RhwpControlInfo[]>(this.document.getControls(), "문서 컨트롤");
    if (!Array.isArray(controls)) {
      throw new Error("문서 컨트롤 응답이 배열이 아닙니다.");
    }
    const tables = this.createTableSnapshots(sectionCount, controls);
    const images = await this.createImageSnapshots();
    const tableCellCount = tables.reduce((total, table) => total + table.cells.length, 0);
    const totalEmbeddedImageBytes = images.reduce((total, image) => total + image.byteLength, 0);
    const largestEmbeddedResourceBytes = images.reduce(
      (largest, image) => Math.max(largest, image.byteLength),
      0,
    );
    const profileBase = {
      compressedBytes: this.compressedBytes,
      pageCount: this.pageCount(),
      paragraphCount,
      snapshotParagraphCount: paragraphs.length,
      tableCount: tables.length,
      tableCellCount,
      graphicControlCount: controls.filter((control) => control.ctrlId === "gso").length,
      imageCount: images.length,
      totalEmbeddedImageBytes,
      largestEmbeddedResourceBytes,
    };
    this.profile = { ...profileBase, level: complexityLevel(profileBase) };
    return { paragraphs, tables, images };
  }

  private async createImageSnapshots(): Promise<ImageSnapshot[]> {
    const snapshots: ImageSnapshot[] = [];
    const sourceHashes = new Map<string, Promise<{ hash: string; byteLength: number }>>();
    let otherImageIndex = 0;
    for (let pageIndex = 0; pageIndex < this.pageCount(); pageIndex += 1) {
      const layout = parseJson<RhwpPageControlLayout>(
        this.document.getPageControlLayout(pageIndex),
        "페이지 컨트롤 위치",
      );
      const flow = parseJson<RhwpPageFlowImageOps>(
        this.document.getPageFlowImageOps(pageIndex),
        "페이지 그림 정보",
      );
      const controls = Array.isArray(layout.controls)
        ? layout.controls.filter(isRecord).filter((control) => control.type === "image")
        : [];
      const operations = Array.isArray(flow.images) ? flow.images.filter(isRecord) : [];
      const unmatched = new Set(operations.map((_, index) => index));

      for (const [pageImageIndex, rawControl] of controls.entries()) {
        const control = rawControl as RhwpImageControlLayout;
        const rect = imageControlRect(control, pageIndex);
        const operationIndex = closestImageOperation(rect, operations, unmatched);
        const operation = operationIndex === undefined
          ? undefined
          : operations[operationIndex] as RhwpFlowImageOp;
        if (operationIndex !== undefined) unmatched.delete(operationIndex);
        const sourceKey = typeof operation?.sourceImageKey === "string"
          ? operation.sourceImageKey
          : undefined;
        const resource = sourceKey
          ? await cachedImageHash(sourceHashes, sourceKey, () => this.document.getSourceImageBytes(sourceKey))
          : await fallbackControlImageHash(this.document, control);
        const mime = typeof operation?.mime === "string"
          ? operation.mime
          : fallbackControlImageMime(this.document, control);
        const stableKey = imageStableKey(control, pageIndex, pageImageIndex);
        const sourceCaption = imageCaptionForControl(this.imageCaptionMetadata, control);
        const classification = imageHasCaption(this.document, control) || sourceCaption
          ? "captioned" as const
          : "other" as const;
        const classificationIndex = classification === "other"
          ? ++otherImageIndex
          : undefined;
        const renderFingerprint = await sha256Hex(new TextEncoder().encode(JSON.stringify({
          mime,
          width: rect.width,
          height: rect.height,
          crop: operation?.crop,
          originalSizeHu: operation?.originalSizeHu,
          effect: operation?.effect,
          brightness: operation?.brightness,
          contrast: operation?.contrast,
          transform: operation?.transform,
          classification,
          captionLabel: sourceCaption?.label,
        })));
        snapshots.push({
          imageIndex: snapshots.length,
          pageIndex,
          sectionIndex: requireNonNegativeInteger(control.secIdx, "그림 구역"),
          paragraphIndex: requireNonNegativeInteger(control.paraIdx, "그림 문단"),
          controlIndex: requireNonNegativeInteger(control.controlIdx, "그림 컨트롤"),
          stableKey,
          mime,
          byteLength: resource.byteLength,
          sourceHash: resource.hash,
          renderFingerprint,
          rect,
          classification,
          captionLabel: sourceCaption?.label,
          classificationIndex,
        });
      }
    }
    return snapshots;
  }

  private getOutlineMap(): Map<string, NonNullable<DocumentSnapshot["paragraphs"][number]["outline"]>> {
    const navigation = parseJson<RhwpOutlineNavigation>(
      this.document.getOutlineNavigation(),
      "개요 navigation",
    );
    if (!Array.isArray(navigation.outline)) {
      throw new Error("개요 navigation 응답이 배열이 아닙니다.");
    }
    const result = new Map<
      string,
      NonNullable<DocumentSnapshot["paragraphs"][number]["outline"]>
    >();
    for (const raw of navigation.outline) {
      if (!isRecord(raw)) continue;
      const entry = raw as RhwpOutlineEntry;
      const sectionIndex = toNonNegativeInteger(entry.section);
      const paragraphIndex = toNonNegativeInteger(entry.paragraph);
      const level = optionalPositiveInteger(entry.level);
      const page = optionalPositiveInteger(entry.page);
      if (
        sectionIndex === undefined ||
        paragraphIndex === undefined ||
        level === undefined ||
        page === undefined ||
        typeof entry.number !== "string" ||
        entry.number.trim().length === 0
      ) continue;
      result.set(`${sectionIndex}:${paragraphIndex}`, {
        level,
        number: entry.number.trim(),
        pageIndex: page - 1,
      });
    }
    return result;
  }

  complexityProfile(): DocumentComplexityProfile {
    this.assertOpen();
    if (!this.profile) throw new Error("문서 snapshot을 먼저 생성해야 합니다.");
    return { ...this.profile };
  }

  pageCount(): number {
    this.assertOpen();
    return this.document.pageCount();
  }

  pageSize(pageIndex: number): PageSize {
    this.assertPage(pageIndex);
    const info = parseJson<RhwpPageInfo>(this.document.getPageInfo(pageIndex), "페이지 정보");
    if (!(info.width > 0 && info.height > 0)) {
      throw new Error("렌더링 엔진이 잘못된 페이지 크기를 반환했습니다.");
    }
    return { width: info.width, height: info.height };
  }

  pageSizes(): PageSize[] {
    return Array.from({ length: this.pageCount() }, (_, pageIndex) => this.pageSize(pageIndex));
  }

  renderSvgPage(pageIndex: number): RenderedPage {
    this.assertPage(pageIndex);
    const safe = sanitizeRenderedSvg(
      this.document.renderPageSvg(pageIndex),
      undefined,
      `${this.svgIdNamespace}-page-${pageIndex}`,
    );
    return { kind: "svg", pageIndex, svg: safe.markup, viewBox: safe.viewBox };
  }

  renderCanvasPage(pageIndex: number): RenderedPage {
    this.assertPage(pageIndex);
    const { width, height } = this.pageSize(pageIndex);
    return {
      kind: "canvas2d",
      pageIndex,
      viewBox: [0, 0, width, height],
      paint: (canvas, scale) => {
        this.assertPage(pageIndex);
        this.document.renderPageToCanvas(pageIndex, canvas, scale);
      },
    };
  }

  resolveVisualTarget(anchor: DocumentAnchor): VisualTarget {
    this.assertOpen();
    if (anchor.target === "image") {
      if (anchor.rect.pageIndex >= this.pageCount()) {
        throw new Error("그림 변경 위치가 현재 문서의 범위를 벗어났습니다.");
      }
      return visualTargetFromRects([anchor.rect]);
    }
    if (anchor.target === "table") {
      return this.resolveTableTarget(anchor);
    }
    if (anchor.target === "table-cell") {
      return this.resolveTableCellTarget(anchor);
    }

    const paragraphCount = this.document.getParagraphCount(anchor.sectionIndex);
    if (anchor.paragraphIndex < 0 || anchor.paragraphIndex >= paragraphCount) {
      throw new Error("변경 위치가 현재 문서의 본문 범위를 벗어났습니다.");
    }

    const paragraphLength = this.document.getParagraphLength(
      anchor.sectionIndex,
      anchor.paragraphIndex,
    );
    const requested = anchor.textRange ?? { start: 0, end: Math.min(1, paragraphLength) };
    const start = clamp(requested.start, 0, paragraphLength);
    const end = clamp(Math.max(requested.end, start + 1), 0, paragraphLength);
    const rects = parseJson<VisualRect[]>(
      this.document.getSelectionRects(
        anchor.sectionIndex,
        anchor.paragraphIndex,
        start,
        anchor.paragraphIndex,
        end,
      ),
      "본문 선택 영역",
    ).filter(isVisualRect);

    if (rects.length === 0) {
      throw new Error("본문 변경 위치의 화면 좌표를 찾지 못했습니다.");
    }
    const pageIndex = rects[0].pageIndex;
    return { pageIndex, rects: rects.filter((rect) => rect.pageIndex === pageIndex) };
  }

  private createTableSnapshots(
    sectionCount: number,
    controls: RhwpControlInfo[],
  ): DocumentSnapshot["tables"] {
    const tableControls = controls.filter((control) => control.ctrlId === "tbl");
    if (tableControls.length > MAX_TABLE_COUNT) {
      throw new Error(`표가 너무 많아 안전하게 비교할 수 없습니다. (${tableControls.length}개)`);
    }

    const cursorModel = parseJson<RhwpCursorModel>(this.document.getCursorModel(), "커서 모델");
    if (!Array.isArray(cursorModel.lists)) {
      throw new Error("커서 모델의 리스트 정보가 올바르지 않습니다.");
    }
    const cursorLists = new Map<number, RhwpCursorListInfo>();
    for (const value of cursorModel.lists) {
      if (!isRecord(value)) {
        throw new Error("커서 모델의 리스트 항목이 올바르지 않습니다.");
      }
      const entry = value as RhwpCursorListInfo;
      const listId = requireNonNegativeInteger(entry.listId, "커서 리스트");
      if (cursorLists.has(listId)) {
        throw new Error(`커서 리스트 ${listId}가 중복되었습니다.`);
      }
      cursorLists.set(listId, entry);
    }
    const sectionParagraphCounts = Array.from({ length: sectionCount }, (_, sectionIndex) =>
      this.document.getParagraphCount(sectionIndex),
    );

    this.tableAddresses.clear();

    let totalCellCount = 0;
    return tableControls.map((control, tableIndex) => {
      const address = resolveRhwpTableAddress(
        control,
        tableIndex,
        sectionParagraphCounts,
        cursorLists,
      );
      this.tableAddresses.set(tableIndex, address);
      const dimensions = this.getTableDimensions(address);
      assertTableDimensions(dimensions);
      if (dimensions.cellCount > MAX_CELLS_PER_TABLE) {
        throw new Error(`표의 셀이 너무 많아 안전하게 비교할 수 없습니다. (${dimensions.cellCount}개)`);
      }
      totalCellCount += dimensions.cellCount;
      if (totalCellCount > MAX_TOTAL_CELL_COUNT) {
        throw new Error(`문서의 전체 표 셀이 너무 많아 안전하게 비교할 수 없습니다. (${totalCellCount}개)`);
      }

      const cells = Array.from({ length: dimensions.cellCount }, (_, cellIndex) => {
        const info = this.getCellInfo(address, cellIndex);
        assertCellInfo(info, dimensions);
        const paragraphCount = this.getCellParagraphCount(address, cellIndex);
        if (
          !Number.isInteger(paragraphCount) ||
          paragraphCount < 0 ||
          paragraphCount > MAX_PARAGRAPHS_PER_CELL
        ) {
          throw new Error(`표 셀의 문단 수가 안전 범위를 벗어났습니다. (${paragraphCount}개)`);
        }
        const paragraphs = Array.from({ length: paragraphCount }, (_, cellParagraphIndex) => {
          const length = this.getCellParagraphLength(address, cellIndex, cellParagraphIndex);
          if (!Number.isInteger(length) || length < 0) {
            throw new Error("표 셀의 텍스트 길이가 올바르지 않습니다.");
          }
          return this.getTextInCell(address, cellIndex, cellParagraphIndex, length);
        });
        return {
          cellIndex,
          row: info.row,
          column: info.col,
          rowSpan: info.rowSpan,
          columnSpan: info.colSpan,
          paragraphs,
        };
      });

      return createTableSnapshot({
        tableIndex,
        sectionIndex: address.sectionIndex,
        paragraphIndex: address.paragraphIndex,
        controlIndex: address.controlIndex,
        rowCount: dimensions.rowCount,
        columnCount: dimensions.colCount,
        cells,
      });
    });
  }

  private getTableDimensions(address: RhwpTableAddress): RhwpTableDimensions {
    const value = address.direct
      ? this.document.getTableDimensions(
          address.sectionIndex,
          address.paragraphIndex,
          address.controlIndex,
        )
      : this.document.getTableDimensionsByPath(
          address.sectionIndex,
          address.paragraphIndex,
          address.pathJson,
        );
    return parseJson<RhwpTableDimensions>(value, "표 크기");
  }

  private getCellInfo(address: RhwpTableAddress, cellIndex: number): RhwpCellInfo {
    const value = address.direct
      ? this.document.getCellInfo(
          address.sectionIndex,
          address.paragraphIndex,
          address.controlIndex,
          cellIndex,
        )
      : this.document.getCellInfoByPath(
          address.sectionIndex,
          address.paragraphIndex,
          tableCellPathJson(address, cellIndex, 0),
        );
    return parseJson<RhwpCellInfo>(value, "표 셀 정보");
  }

  private getCellParagraphCount(address: RhwpTableAddress, cellIndex: number): number {
    return address.direct
      ? this.document.getCellParagraphCount(
          address.sectionIndex,
          address.paragraphIndex,
          address.controlIndex,
          cellIndex,
        )
      : this.document.getCellParagraphCountByPath(
          address.sectionIndex,
          address.paragraphIndex,
          tableCellPathJson(address, cellIndex, 0),
        );
  }

  private getCellParagraphLength(
    address: RhwpTableAddress,
    cellIndex: number,
    cellParagraphIndex: number,
  ): number {
    return address.direct
      ? this.document.getCellParagraphLength(
          address.sectionIndex,
          address.paragraphIndex,
          address.controlIndex,
          cellIndex,
          cellParagraphIndex,
        )
      : this.document.getCellParagraphLengthByPath(
          address.sectionIndex,
          address.paragraphIndex,
          tableCellPathJson(address, cellIndex, cellParagraphIndex),
        );
  }

  private getTextInCell(
    address: RhwpTableAddress,
    cellIndex: number,
    cellParagraphIndex: number,
    length: number,
  ): string {
    return address.direct
      ? this.document.getTextInCell(
          address.sectionIndex,
          address.paragraphIndex,
          address.controlIndex,
          cellIndex,
          cellParagraphIndex,
          0,
          length,
        )
      : this.document.getTextInCellByPath(
          address.sectionIndex,
          address.paragraphIndex,
          tableCellPathJson(address, cellIndex, cellParagraphIndex),
          0,
          length,
        );
  }

  private resolveTableTarget(anchor: Extract<DocumentAnchor, { target: "table" }>): VisualTarget {
    const address = this.resolveTableAddress(anchor);
    if (address.direct) {
      const rect = parseJson<RhwpBBox>(
        this.document.getTableBBox(
          address.sectionIndex,
          address.paragraphIndex,
          address.controlIndex,
        ),
        "표 위치",
      );
      return visualTargetFromRects([rect]);
    }
    return visualTargetFromRects(this.getTableCellVisualRects(address));
  }

  private resolveTableCellTarget(
    anchor: Extract<DocumentAnchor, { target: "table-cell" }>,
  ): VisualTarget {
    const address = this.resolveTableAddress(anchor);
    const rects = this.getTableCellVisualRects(address)
      .filter((rect) => rect.cellIdx === anchor.cellIndex)
      .map((rect) => ({
        pageIndex: rect.pageIndex,
        x: rect.x,
        y: rect.y,
        width: rect.w,
        height: rect.h,
      }));
    if (rects.length === 0) {
      throw new Error("표 셀의 화면 좌표를 찾지 못했습니다.");
    }
    return visualTargetFromRects(rects);
  }

  private resolveTableAddress(
    anchor: Extract<DocumentAnchor, { target: "table" | "table-cell" }>,
  ): RhwpTableAddress {
    const address = this.tableAddresses.get(anchor.tableIndex);
    if (
      !address ||
      address.sectionIndex !== anchor.sectionIndex ||
      address.paragraphIndex !== anchor.paragraphIndex ||
      address.controlIndex !== anchor.controlIndex
    ) {
      throw new Error("표 변경 위치가 현재 문서의 범위를 벗어났습니다.");
    }
    return address;
  }

  private getTableCellVisualRects(
    address: RhwpTableAddress,
  ): Array<RhwpTableCellBBox & VisualRect> {
    const value = address.direct
      ? this.document.getTableCellBboxes(
          address.sectionIndex,
          address.paragraphIndex,
          address.controlIndex,
        )
      : this.document.getTableCellBboxesByPath(
          address.sectionIndex,
          address.paragraphIndex,
          address.pathJson,
        );
    return parseJson<RhwpTableCellBBox[]>(value, "표 셀 위치").map((rect) => ({
      ...rect,
      width: rect.w,
      height: rect.h,
    }));
  }

  dispose(): void {
    if (!this.disposed) {
      this.disposed = true;
      this.document.free();
    }
  }

  private assertPage(pageIndex: number): void {
    this.assertOpen();
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= this.document.pageCount()) {
      throw new Error(`페이지 ${pageIndex + 1}을(를) 열 수 없습니다.`);
    }
  }

  private assertOpen(): void {
    if (this.disposed) {
      throw new Error("이미 닫힌 HWPX 문서입니다.");
    }
  }
}

class RhwpSvgRenderingAdapter implements RenderingAdapter {
  readonly rendererKind = "svg" as const;

  constructor(private readonly session: RhwpDocumentSession) {}

  pageCount(): number {
    return this.session.pageCount();
  }

  async pageSize(pageIndex: number): Promise<PageSize> {
    return this.session.pageSize(pageIndex);
  }

  async pageSizes(): Promise<PageSize[]> {
    return this.session.pageSizes();
  }

  async renderPage(pageIndex: number): Promise<RenderedPage> {
    return this.session.renderSvgPage(pageIndex);
  }

  async resolveVisualTarget(anchor: DocumentAnchor): Promise<VisualTarget> {
    return this.session.resolveVisualTarget(anchor);
  }

  dispose(): void {
    this.session.dispose();
  }
}

class RhwpCanvasRenderingAdapter implements RenderingAdapter {
  readonly rendererKind = "canvas2d" as const;

  constructor(private readonly session: RhwpDocumentSession) {}

  pageCount(): number {
    return this.session.pageCount();
  }

  async pageSize(pageIndex: number): Promise<PageSize> {
    return this.session.pageSize(pageIndex);
  }

  async pageSizes(): Promise<PageSize[]> {
    return this.session.pageSizes();
  }

  async renderPage(pageIndex: number): Promise<RenderedPage> {
    return this.session.renderCanvasPage(pageIndex);
  }

  async resolveVisualTarget(anchor: DocumentAnchor): Promise<VisualTarget> {
    return this.session.resolveVisualTarget(anchor);
  }

  dispose(): void {
    this.session.dispose();
  }
}

class RhwpLensDocument implements LensDocument {
  readonly analysisIdentity = RHWP_ANALYSIS_IDENTITY;
  readonly rendering: RenderingAdapter;
  readonly interaction?: InteractionAdapter;

  constructor(
    private readonly session: RhwpDocumentSession,
    renderingKind: "svg" | "canvas2d",
    interaction?: InteractionAdapter,
  ) {
    this.rendering = renderingKind === "canvas2d"
      ? new RhwpCanvasRenderingAdapter(session)
      : new RhwpSvgRenderingAdapter(session);
    this.interaction = interaction;
  }

  async createSnapshot(): Promise<DocumentSnapshot> {
    return this.session.createSnapshot();
  }

  async complexityProfile(): Promise<DocumentComplexityProfile> {
    return this.session.complexityProfile();
  }

  dispose(): void {
    this.session.dispose();
  }
}

export async function createRhwpDocument(bytes: Uint8Array): Promise<LensDocument> {
  return createRhwpDocumentWithOptions(bytes, "svg", "native");
}

/** Explicit opt-in entry point for the isolated SVG interaction PoC. */
export async function createRhwpInteractionPocDocument(bytes: Uint8Array): Promise<LensDocument> {
  return createRhwpDocumentWithOptions(bytes, "svg", "semantic-text");
}

/** Explicit opt-in entry point for the isolated Canvas2D/native interaction PoC. */
export async function createRhwpCanvasPocDocument(bytes: Uint8Array): Promise<LensDocument> {
  return createRhwpDocumentWithOptions(bytes, "canvas2d", "native");
}

async function createRhwpDocumentWithOptions(
  bytes: Uint8Array,
  renderingKind: "svg" | "canvas2d",
  interactionKind: "none" | "semantic-text" | "native",
): Promise<LensDocument> {
  await ensureRhwpInitialized();
  try {
    // Give WASM a tightly-sized, owned buffer. File APIs and ZIP tooling can
    // return views with non-zero offsets or oversized backing ArrayBuffers.
    const ownedBytes = Uint8Array.from(bytes);
    const imageCaptionMetadata = extractImageCaptionMetadata(ownedBytes);
    const rhwpDocument = new HwpDocument(ownedBytes);
    const session = new RhwpDocumentSession(
      rhwpDocument,
      ownedBytes.byteLength,
      imageCaptionMetadata,
    );
    const interaction = interactionKind === "semantic-text"
      ? new RhwpSemanticInteractionAdapter(rhwpDocument)
      : interactionKind === "native"
        ? new RhwpNativeInteractionAdapter(rhwpDocument)
        : undefined;
    return new RhwpLensDocument(
      session,
      renderingKind,
      interaction,
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`HWPX 문서를 열 수 없습니다. 파일이 손상되었거나 지원되지 않는 형식입니다. (${detail})`, {
      cause: error,
    });
  }
}

function imageControlRect(control: RhwpImageControlLayout, pageIndex: number): VisualRect {
  const rect = {
    pageIndex,
    x: requireFiniteNumber(control.x, "그림 x"),
    y: requireFiniteNumber(control.y, "그림 y"),
    width: requirePositiveNumber(control.w, "그림 너비"),
    height: requirePositiveNumber(control.h, "그림 높이"),
  };
  if (!isVisualRect(rect)) throw new Error("그림 위치가 올바르지 않습니다.");
  return rect;
}

function closestImageOperation(
  controlRect: VisualRect,
  operations: Record<string, unknown>[],
  unmatched: Set<number>,
): number | undefined {
  let best: { index: number; distance: number } | undefined;
  for (const index of unmatched) {
    const bbox = operations[index].bbox;
    if (!isRecord(bbox)) continue;
    const rect = {
      x: finiteNumber(bbox.x),
      y: finiteNumber(bbox.y),
      width: finiteNumber(bbox.width),
      height: finiteNumber(bbox.height),
    };
    if (Object.values(rect).some((value) => value === undefined)) continue;
    const distance = Math.abs(controlRect.x - rect.x!) +
      Math.abs(controlRect.y - rect.y!) +
      Math.abs(controlRect.width - rect.width!) +
      Math.abs(controlRect.height - rect.height!);
    if (!best || distance < best.distance) best = { index, distance };
  }
  return best?.index;
}

function imageStableKey(
  control: RhwpImageControlLayout,
  pageIndex: number,
  pageImageIndex: number,
): string {
  const stableIndex = Array.isArray(control.stableIndex)
    ? control.stableIndex.filter((value): value is number => Number.isInteger(value))
    : [];
  const cellPath = Array.isArray(control.cellPath) ? control.cellPath : [];
  return JSON.stringify({
    section: control.secIdx,
    paragraph: control.paraIdx,
    control: control.controlIdx,
    cellPath,
    stableIndex,
    fallback: stableIndex.length === 0 ? [pageIndex, pageImageIndex] : undefined,
  });
}

function imageCaptionForControl(
  metadata: ReadonlyMap<string, ImageCaptionMetadata>,
  control: RhwpImageControlLayout,
): ImageCaptionMetadata | undefined {
  const stableIndex = Array.isArray(control.stableIndex)
    ? control.stableIndex.filter((value): value is number =>
      Number.isSafeInteger(value) && value >= 0,
    )
    : [];
  return stableIndex.length >= 3
    ? metadata.get(imageStableIndexKey(stableIndex))
    : undefined;
}

function imageHasCaption(
  document: HwpDocument,
  control: RhwpImageControlLayout,
): boolean {
  const sectionIndex = toNonNegativeInteger(control.secIdx);
  const paragraphIndex = toNonNegativeInteger(control.paraIdx);
  const controlIndex = toNonNegativeInteger(control.controlIdx);
  if (
    sectionIndex === undefined ||
    paragraphIndex === undefined ||
    controlIndex === undefined
  ) return false;

  try {
    const cellPath = Array.isArray(control.cellPath) ? control.cellPath : [];
    const raw = cellPath.length > 0
      ? document.getCellPicturePropertiesByPath(
        sectionIndex,
        paragraphIndex,
        JSON.stringify(cellPath),
        controlIndex,
      )
      : document.getPictureProperties(sectionIndex, paragraphIndex, controlIndex);
    const properties = parseJson<RhwpPictureProperties>(raw, "그림 속성");
    return properties.hasCaption === true;
  } catch {
    return false;
  }
}

async function cachedImageHash(
  cache: Map<string, Promise<{ hash: string; byteLength: number }>>,
  key: string,
  read: () => Uint8Array,
): Promise<{ hash: string; byteLength: number }> {
  let pending = cache.get(key);
  if (!pending) {
    pending = Promise.resolve().then(async () => {
      const bytes = read();
      return { hash: await sha256Hex(bytes), byteLength: bytes.byteLength };
    });
    cache.set(key, pending);
  }
  return pending;
}

async function fallbackControlImageHash(
  document: HwpDocument,
  control: RhwpImageControlLayout,
): Promise<{ hash: string; byteLength: number }> {
  const sectionIndex = requireNonNegativeInteger(control.secIdx, "그림 구역");
  const paragraphIndex = requireNonNegativeInteger(control.paraIdx, "그림 문단");
  const controlIndex = requireNonNegativeInteger(control.controlIdx, "그림 컨트롤");
  const path = JSON.stringify(Array.isArray(control.cellPath) ? control.cellPath : []);
  const bytes = document.getControlImageData(sectionIndex, paragraphIndex, path, controlIndex);
  if (bytes.byteLength === 0) throw new Error("그림 원본 바이트를 찾지 못했습니다.");
  return { hash: await sha256Hex(bytes), byteLength: bytes.byteLength };
}

function fallbackControlImageMime(
  document: HwpDocument,
  control: RhwpImageControlLayout,
): string {
  try {
    return document.getControlImageMime(
      requireNonNegativeInteger(control.secIdx, "그림 구역"),
      requireNonNegativeInteger(control.paraIdx, "그림 문단"),
      JSON.stringify(Array.isArray(control.cellPath) ? control.cellPath : []),
      requireNonNegativeInteger(control.controlIdx, "그림 컨트롤"),
    ) || "application/octet-stream";
  } catch {
    return "application/octet-stream";
  }
}

function parseJson<T>(value: string, label: string): T {
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    throw new Error(`${label} 응답을 해석하지 못했습니다.`, { cause: error });
  }
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function requireFiniteNumber(value: unknown, label: string): number {
  const parsed = finiteNumber(value);
  if (parsed === undefined) throw new Error(`${label} 값이 올바르지 않습니다.`);
  return parsed;
}

function requirePositiveNumber(value: unknown, label: string): number {
  const parsed = requireFiniteNumber(value, label);
  if (parsed <= 0) throw new Error(`${label} 값이 올바르지 않습니다.`);
  return parsed;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function complexityLevel(
  profile: Omit<DocumentComplexityProfile, "level">,
): DocumentComplexityProfile["level"] {
  if (
    profile.compressedBytes > 100 * 1024 * 1024 ||
    profile.pageCount > 250 ||
    profile.paragraphCount > 5_000 ||
    profile.tableCount > 500 ||
    profile.tableCellCount > 20_000
  ) return "high";
  if (
    profile.compressedBytes > 20 * 1024 * 1024 ||
    profile.pageCount > 50 ||
    profile.paragraphCount > 1_000 ||
    profile.tableCount > 100 ||
    profile.tableCellCount > 5_000
  ) return "medium";
  return "low";
}

function isVisualRect(rect: VisualRect): boolean {
  return (
    Number.isInteger(rect.pageIndex) &&
    rect.pageIndex >= 0 &&
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width >= 0 &&
    rect.height > 0
  );
}

function visualTargetFromRects(rects: VisualRect[]): VisualTarget {
  const valid = rects.filter(isVisualRect).sort((left, right) =>
    left.pageIndex - right.pageIndex || left.y - right.y || left.x - right.x,
  );
  if (valid.length === 0) {
    throw new Error("변경 위치의 화면 좌표를 찾지 못했습니다.");
  }
  const pageIndex = valid[0].pageIndex;
  return { pageIndex, rects: valid.filter((rect) => rect.pageIndex === pageIndex) };
}

function toNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function optionalPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  const parsed = toNonNegativeInteger(value);
  if (parsed === undefined) throw new Error(`${label} 인덱스가 올바르지 않습니다.`);
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function resolveRhwpTableAddress(
  control: RhwpControlInfo,
  tableIndex: number,
  sectionParagraphCounts: number[],
  cursorLists: Map<number, RhwpCursorListInfo>,
): RhwpTableAddress {
  const listId = requireNonNegativeInteger(control.list, "표 리스트");
  const paragraphInList = requireNonNegativeInteger(control.para, "표 문단");
  const controlIndex = requireNonNegativeInteger(control.controlIndex, "표 컨트롤");

  if (listId === 0) {
    const location = rootParagraphLocation(paragraphInList, sectionParagraphCounts);
    if (!location) {
      throw new Error(`본문 표 ${tableIndex + 1}의 문단 위치를 찾지 못했습니다.`);
    }
    const path = [{ controlIndex, cellIndex: 0, cellParaIndex: 0 }];
    return {
      tableIndex,
      sectionIndex: location.sectionIndex,
      paragraphIndex: location.paragraphIndex,
      controlIndex,
      direct: true,
      path,
      pathJson: JSON.stringify(path),
    };
  }

  const reversedPath: RhwpCellPathEntry[] = [];
  const visited = new Set<number>();
  let currentListId = listId;
  let paragraphIndex = paragraphInList;
  let rootSectionIndex: number | undefined;
  let rootParagraphIndex: number | undefined;

  while (currentListId !== 0) {
    if (visited.has(currentListId)) {
      throw new Error(`표 ${tableIndex + 1}의 중첩 경로에 순환 참조가 있습니다.`);
    }
    visited.add(currentListId);
    const entry = cursorLists.get(currentListId);
    if (!entry) {
      throw new Error(`표 ${tableIndex + 1}의 커서 리스트 ${currentListId}를 찾지 못했습니다.`);
    }
    const hostListId = requireNonNegativeInteger(entry.hostListId, "부모 커서 리스트");
    const hostParagraphIndex = requireNonNegativeInteger(entry.hostPara, "부모 문단");
    reversedPath.push({
      controlIndex: requireNonNegativeInteger(entry.controlIndex, "부모 컨트롤"),
      cellIndex: requireNonNegativeInteger(entry.cellIndex, "부모 셀"),
      cellParaIndex: paragraphIndex,
    });

    if (hostListId === 0) {
      rootSectionIndex = requireNonNegativeInteger(entry.sectionIndex, "표 구역");
      rootParagraphIndex = hostParagraphIndex;
      break;
    }
    paragraphIndex = hostParagraphIndex;
    currentListId = hostListId;
  }

  if (
    rootSectionIndex === undefined ||
    rootSectionIndex >= sectionParagraphCounts.length ||
    rootParagraphIndex === undefined ||
    rootParagraphIndex >= sectionParagraphCounts[rootSectionIndex]
  ) {
    throw new Error(`표 ${tableIndex + 1}의 본문 기준 위치가 올바르지 않습니다.`);
  }

  const path = reversedPath.reverse();
  path.push({ controlIndex, cellIndex: 0, cellParaIndex: 0 });
  return {
    tableIndex,
    sectionIndex: rootSectionIndex,
    paragraphIndex: rootParagraphIndex,
    controlIndex,
    direct: false,
    path,
    pathJson: JSON.stringify(path),
  };
}

function rootParagraphLocation(
  paragraphInBody: number,
  sectionParagraphCounts: number[],
): { sectionIndex: number; paragraphIndex: number } | undefined {
  let remaining = paragraphInBody;
  for (const [sectionIndex, paragraphCount] of sectionParagraphCounts.entries()) {
    if (remaining < paragraphCount) {
      return { sectionIndex, paragraphIndex: remaining };
    }
    remaining -= paragraphCount;
  }
  return undefined;
}

function tableCellPathJson(
  address: RhwpTableAddress,
  cellIndex: number,
  cellParagraphIndex: number,
): string {
  const path = address.path.map((entry) => ({ ...entry }));
  const target = path.at(-1);
  if (!target) {
    throw new Error("표 셀 경로가 비어 있습니다.");
  }
  target.cellIndex = cellIndex;
  target.cellParaIndex = cellParagraphIndex;
  return JSON.stringify(path);
}

function assertTableDimensions(dimensions: RhwpTableDimensions): void {
  if (
    !Number.isInteger(dimensions.rowCount) ||
    dimensions.rowCount < 0 ||
    !Number.isInteger(dimensions.colCount) ||
    dimensions.colCount < 0 ||
    !Number.isInteger(dimensions.cellCount) ||
    dimensions.cellCount < 0
  ) {
    throw new Error("표의 행·열·셀 수가 올바르지 않습니다.");
  }
}

function assertCellInfo(info: RhwpCellInfo, table: RhwpTableDimensions): void {
  if (
    !Number.isInteger(info.row) ||
    info.row < 0 ||
    info.row >= table.rowCount ||
    !Number.isInteger(info.col) ||
    info.col < 0 ||
    info.col >= table.colCount ||
    !Number.isInteger(info.rowSpan) ||
    info.rowSpan < 1 ||
    info.row + info.rowSpan > table.rowCount ||
    !Number.isInteger(info.colSpan) ||
    info.colSpan < 1 ||
    info.col + info.colSpan > table.colCount
  ) {
    throw new Error("표 셀의 행·열·병합 정보가 올바르지 않습니다.");
  }
}
