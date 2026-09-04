export type ChangeKind = "added" | "removed" | "modified";
export type ChangeType = "text" | "outline" | "table" | "image";
export type MappingConfidence = "exact" | "contextual" | "approximate";

export interface TextRange {
  /** Inclusive UTF-16 offset in the source paragraph. */
  start: number;
  /** Exclusive UTF-16 offset in the source paragraph. */
  end: number;
}

/**
 * Engine-neutral location in a document. Adapter implementations translate
 * this coordinate into their own model; engine-specific objects never cross
 * this boundary.
 */
interface AnchorBase {
  sectionIndex: number;
  confidence: MappingConfidence;
}

export interface BodyTextAnchor extends AnchorBase {
  target: "body-text";
  paragraphIndex: number;
  textRange?: TextRange;
  textFingerprint?: string;
  contextFingerprint?: string;
  /** Generated outline label rendered immediately before paragraph text. */
  generatedPrefix?: {
    text: string;
    pageIndex: number;
  };
}

export interface TableAnchor extends AnchorBase {
  target: "table";
  tableIndex: number;
  paragraphIndex: number;
  controlIndex: number;
}

export interface TableCellAnchor extends AnchorBase {
  target: "table-cell";
  tableIndex: number;
  paragraphIndex: number;
  controlIndex: number;
  cellIndex: number;
  row: number;
  column: number;
  rowSpan: number;
  columnSpan: number;
  textFingerprint?: string;
}

export interface ImageAnchor extends AnchorBase {
  target: "image";
  imageIndex: number;
  paragraphIndex: number;
  /** Stable semantic/layout identity supplied by the document adapter. */
  stableKey: string;
  /** Document-space geometry; independent of SVG/Canvas viewport scaling. */
  rect: VisualRect;
}

export type DocumentAnchor = BodyTextAnchor | TableAnchor | TableCellAnchor | ImageAnchor;

export interface ParagraphSnapshot {
  sectionIndex: number;
  paragraphIndex: number;
  text: string;
  normalizedText: string;
  fingerprint: string;
  /** Optional alignment hint; never used as user-visible or copied text. */
  alignmentText?: string;
  /** Exact semantic identity used for stable alignment before fuzzy text comparison. */
  alignmentIdentity?: string;
  /** Public rhwp outline metadata. Generated numbering is not part of `text`. */
  outline?: {
    level: number;
    number: string;
    pageIndex: number;
  };
}

export interface TableCellSnapshot {
  cellIndex: number;
  row: number;
  column: number;
  rowSpan: number;
  columnSpan: number;
  paragraphs: string[];
  text: string;
  normalizedText: string;
  fingerprint: string;
}

export interface TableSnapshot {
  tableIndex: number;
  sectionIndex: number;
  paragraphIndex: number;
  controlIndex: number;
  rowCount: number;
  columnCount: number;
  cells: TableCellSnapshot[];
  structureFingerprint: string;
  contentFingerprint: string;
  fingerprint: string;
  /** Normalized direct cell labels available to optional local taxonomy rules. */
  classificationLabels: string[];
}

export interface ImageSnapshot {
  imageIndex: number;
  pageIndex: number;
  sectionIndex: number;
  paragraphIndex: number;
  controlIndex: number;
  stableKey: string;
  mime: string;
  byteLength: number;
  /** SHA-256 of the original encoded resource bytes. */
  sourceHash: string;
  /** Hash of visual metadata such as crop, size, effects and transform. */
  renderFingerprint: string;
  rect: VisualRect;
  /** Semantic source classification; never inferred from the global image index. */
  classification: "captioned" | "other";
  /** Evaluated source caption identifier such as `그림 2-1`. */
  captionLabel?: string;
  /** One-based ordinal among uncaptioned images only. */
  classificationIndex?: number;
}

export interface DocumentSnapshot {
  paragraphs: ParagraphSnapshot[];
  tables: TableSnapshot[];
  /** Optional for backward-compatible cached/test snapshots created before v0.1.0. */
  images?: ImageSnapshot[];
}

export type DocumentComplexityLevel = "low" | "medium" | "high";

/** Cheap structural facts collected without decoding visual image resources. */
export interface DocumentComplexityProfile {
  compressedBytes: number;
  pageCount: number;
  paragraphCount: number;
  snapshotParagraphCount: number;
  tableCount: number;
  tableCellCount: number;
  graphicControlCount: number;
  /** Exact image/resource counts are deliberately deferred when collection is expensive. */
  imageCount: number | null;
  totalEmbeddedImageBytes: number | null;
  largestEmbeddedResourceBytes: number | null;
  level: DocumentComplexityLevel;
}

export interface VisualRect {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VisualTarget {
  pageIndex: number;
  rects: VisualRect[];
}

export interface PageSize {
  width: number;
  height: number;
}

export interface SvgRenderedPage {
  kind: "svg";
  pageIndex: number;
  svg: string;
  viewBox: [number, number, number, number];
}

/**
 * Engine-neutral Canvas2D page. The adapter owns the renderer-specific paint
 * implementation; Lens UI only supplies a canvas and a page-space scale.
 */
export interface Canvas2DRenderedPage {
  kind: "canvas2d";
  pageIndex: number;
  viewBox: [number, number, number, number];
  paint(canvas: HTMLCanvasElement, scale: number): void;
}

export type RenderedPage = SvgRenderedPage | Canvas2DRenderedPage;

export interface SemanticTextStyle {
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  letterSpacing: number;
}

/**
 * Engine-neutral text geometry for one visually continuous run. Coordinates
 * use the same page space as RenderedPage.viewBox and VisualRect.
 */
export interface SemanticTextRun {
  id: string;
  blockId: string;
  readingOrder: number;
  text: string;
  rect: VisualRect;
  /** X boundaries relative to rect.x. Length is text.length + 1 when exact. */
  characterX: number[];
  style: SemanticTextStyle;
  anchor?: BodyTextAnchor;
}

export interface SemanticTextPage {
  pageIndex: number;
  runs: SemanticTextRun[];
}

interface ChangeBase {
  id: string;
  type: ChangeType;
  kind: ChangeKind;
  originalText?: string;
  modifiedText?: string;
  originalAnchor?: DocumentAnchor;
  modifiedAnchor?: DocumentAnchor;
  originalContextAnchor?: DocumentAnchor;
  modifiedContextAnchor?: DocumentAnchor;
}

export interface TextChange extends ChangeBase {
  type: "text";
  detail?: "content" | "whitespace";
  /** Character-level alignment inside a modified paragraph. */
  segments?: TextChangeSegment[];
}

export type OutlineChangeDetail = "renamed" | "outline-added" | "outline-removed";

export interface OutlineChange extends ChangeBase {
  type: "outline";
  detail: OutlineChangeDetail;
  locationLabel: string;
  level: number;
  /** Character-level alignment inside a renamed outline item. */
  segments?: TextChangeSegment[];
}

export type TextChangeSegmentKind = "equal" | "added" | "removed" | "modified";
export type WhitespaceChangeKind = "inserted" | "removed";

export interface TextChangeSegment {
  kind: TextChangeSegmentKind;
  originalRange?: TextRange;
  modifiedRange?: TextRange;
  /** Insertion point on the side where this segment has no characters. */
  originalBoundary?: number;
  modifiedBoundary?: number;
  whitespace?: WhitespaceChangeKind;
}

export type TableChangeDetail =
  | "cell-text"
  | "structure"
  | "table-added"
  | "table-removed";

export interface TableChange extends ChangeBase {
  type: "table";
  detail: TableChangeDetail;
  locationLabel: string;
  classificationLabels?: string[];
}

export type ImageChangeDetail = "image-added" | "image-removed" | "image-changed";

export interface ImageChange extends ChangeBase {
  type: "image";
  detail: ImageChangeDetail;
  locationLabel: string;
  binaryChanged: boolean;
  renderingChanged: boolean;
  classification: "captioned" | "other";
  captionLabel?: string;
}

export type Change = TextChange | OutlineChange | TableChange | ImageChange;

export interface DiffAdapter {
  /** Versioned semantic identity used to invalidate in-memory analysis results. */
  readonly analysisIdentity: string;
  readonly supportedTypes: readonly ChangeType[];
  compare(
    original: DocumentSnapshot,
    modified: DocumentSnapshot,
  ): Promise<Change[]>;
}

export interface RenderingAdapter {
  readonly rendererKind: "svg" | "canvas2d";
  pageCount(): number;
  pageSize(pageIndex: number): Promise<PageSize>;
  pageSizes(): Promise<PageSize[]>;
  renderPage(pageIndex: number): Promise<RenderedPage>;
  resolveVisualTarget(anchor: DocumentAnchor): Promise<VisualTarget>;
  dispose(): void;
}

export interface InteractionAdapterBase {
  resolveTextTarget(anchor: BodyTextAnchor): Promise<VisualTarget>;
}

/** Renderer-neutral body position returned from a native page hit-test. */
export interface NativeBodyPosition {
  target: "body-text";
  pageIndex: number;
  sectionIndex: number;
  paragraphIndex: number;
  charOffset: number;
}

export interface NativeCellPathEntry {
  controlIndex: number;
  cellIndex: number;
  cellParaIndex: number;
}

/** Renderer-neutral table-cell position returned from a native page hit-test. */
export interface NativeCellPosition {
  target: "table-cell-text";
  pageIndex: number;
  sectionIndex: number;
  parentParagraphIndex: number;
  controlIndex: number;
  cellIndex: number;
  cellParagraphIndex: number;
  charOffset: number;
  cellPath: NativeCellPathEntry[];
}

export type NativeDocumentPosition = NativeBodyPosition | NativeCellPosition;

/** Stable semantic text position used by Lens Core and review overlays. */
export type LensTextPosition = NativeDocumentPosition;

/** Half-open semantic text range: start is inclusive and end is exclusive. */
export interface LensTextRange {
  start: LensTextPosition;
  end: LensTextPosition;
}

/** A caret boundary in document coordinates, independent of renderer/zoom. */
export interface TextBoundaryGeometry {
  position: LensTextPosition;
  pageIndex: number;
  x: number;
  y: number;
  height: number;
}

/**
 * Geometry for one semantic character. `before` and `after` are retained
 * separately so wrapped characters and future whitespace proofing marks can
 * use the engine's real caret boundaries instead of estimated text widths.
 */
export interface CharacterGeometry {
  position: LensTextPosition;
  rects: VisualRect[];
  before: TextBoundaryGeometry;
  after: TextBoundaryGeometry;
}

export type ReviewInkKind =
  | "text-modified"
  | "text-added"
  | "text-removed"
  | "text-boundary"
  | "whitespace-missing"
  | "table-caption"
  | "table-cell"
  | "image-caption"
  | "image-region";

export type ReviewInkSide = "original" | "modified";

/** Semantic review mark. It contains no renderer node or viewport coordinate. */
export interface ReviewInkModel {
  id: string;
  changeId: string;
  kind: ReviewInkKind;
  side: ReviewInkSide;
  anchor: DocumentAnchor;
  /** Character boundary where an absent space must be inserted. */
  whitespaceBoundaryOffset?: number;
  /** Proofreading convention: add a space with a check, remove it with the existing join bracket. */
  whitespaceMark?: "check" | "join";
  /** Character insertion boundary used when text exists only on the other side. */
  textBoundaryOffset?: number;
}

export interface WhitespaceBoundaryGeometry {
  pageIndex: number;
  before: VisualRect;
  after: VisualRect;
  boundaryX: number;
  baselineY: number;
  mark: "check" | "join";
  marker: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

/** Renderer-neutral page geometry consumed by ReviewInkRenderer. */
export interface ReviewInkGeometry {
  id: string;
  changeId: string;
  kind: ReviewInkKind;
  side: ReviewInkSide;
  pageIndex: number;
  rects: VisualRect[];
  whitespaceBoundary?: WhitespaceBoundaryGeometry;
  textBoundary?: TextBoundaryGeometry;
}

export interface NativeSelection {
  anchor: NativeDocumentPosition;
  focus: NativeDocumentPosition;
}

export interface ClipboardPayload {
  plainText: string;
  html?: string;
}

/** Optional HTML text overlay used only by the isolated SVG experiment. */
export interface SemanticTextInteractionAdapter extends InteractionAdapterBase {
  readonly kind: "semantic-text";
  getTextPage(pageIndex: number): Promise<SemanticTextPage>;
}

/**
 * Native document interaction primitives. All engine objects and JSON formats
 * are normalized inside the adapter before crossing this boundary.
 */
export interface NativeInteractionAdapter extends InteractionAdapterBase {
  readonly kind: "native";
  hitTest(pageIndex: number, x: number, y: number): NativeDocumentPosition;
  getSelectionRects(selection: NativeSelection): VisualRect[];
  getCharacterGeometry(position: NativeDocumentPosition): CharacterGeometry | undefined;
  copySelection(selection: NativeSelection): ClipboardPayload;
}

export type InteractionAdapter =
  | SemanticTextInteractionAdapter
  | NativeInteractionAdapter;

/**
 * Renderer-neutral document lifecycle and semantic snapshot boundary.
 * Engine-specific document objects must not cross this interface.
 */
export interface DocumentAdapter {
  /** Includes the engine and snapshot schema versions, never a document identifier. */
  readonly analysisIdentity: string;
  createSnapshot(): Promise<DocumentSnapshot>;
  complexityProfile(): Promise<DocumentComplexityProfile>;
  dispose(): void;
}

export interface LensDocument extends DocumentAdapter {
  readonly rendering: RenderingAdapter;
  readonly interaction?: InteractionAdapter;
}

export type OpenDocument = (bytes: Uint8Array) => Promise<LensDocument>;
