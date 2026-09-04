import { alignOutlineSnapshots, type OutlineParagraph } from "./outline-diff";
import { sha256Hex } from "./ephemeral-cache";
import { fingerprintText, normalizeParagraphText } from "./text";
import type {
  Change,
  ChangeType,
  DocumentAnchor,
  DocumentSnapshot,
  ImageSnapshot,
  MappingConfidence,
  ParagraphSnapshot,
  TableCellSnapshot,
  TableSnapshot,
  TextChangeSegment,
} from "./types";
import {
  CHANGE_SET_SCHEMA_VERSION,
  type ChangeSet,
  type ChangeSetAnalysis,
  type ChangeSetChange,
  type ChangeSetCoordinateSystem,
  type ChangeSetData,
  type ChangeSetDocument,
  type ChangeSetFingerprintSpec,
  type ChangeSetGenerator,
  type ChangeSetImageSummary,
  type ChangeSetOutlineMapping,
  type ChangeSetSegment,
  type ChangeSetSide,
  type ChangeSetSummary,
  type ChangeSetTableSummary,
  type OutlineMappingSide,
  type OutlinePath,
  type OutlinePathSegment,
  type OutlineRelation,
} from "./change-set-types";

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const FINGERPRINT_PATTERN = /^[0-9a-f]{8}$/u;
const TYPE_ORDER: Record<ChangeType, number> = {
  outline: 0,
  text: 1,
  table: 2,
  image: 3,
};
const CONFIDENCE_ORDER: Record<MappingConfidence, number> = {
  approximate: 0,
  contextual: 1,
  exact: 2,
};
const RELATION_ORDER: OutlineRelation[] = [
  "unchanged",
  "moved",
  "renamed",
  "modified",
  "added",
  "removed",
];

export const CHANGE_SET_PRIVACY_WARNING =
  "Change Set JSON에는 파일명, 문서의 변경 전후 텍스트, 목차 경로, 위치 정보 및 지문이 포함될 수 있습니다. 원본 이미지 바이너리는 포함되지 않지만 문서 내용 자체는 민감하거나 개인정보를 포함할 수 있으므로 저장·공유 위치를 확인하십시오.";

export interface ChangeSetDocumentInput {
  fileName: string;
  bytes: Uint8Array;
  snapshot: DocumentSnapshot;
}

export interface BuildChangeSetInput {
  original: ChangeSetDocumentInput;
  modified: ChangeSetDocumentInput;
  changes: readonly Change[];
  generator: Omit<ChangeSetGenerator, "name"> & { name?: "HWPX Lens" };
  analysis?: Partial<ChangeSetAnalysis>;
  exportId: string;
  exportedAt: string;
}

interface OutlineEntry {
  side: "original" | "modified";
  outlineId: string;
  paragraph: OutlineParagraph;
  order: number;
  path: OutlinePath;
  parentPathKey: string;
  titleFingerprint: string;
  contentFingerprint: string;
  scopeStart: number;
  scopeEnd: number;
}

interface ChangeBuildContext {
  original: DocumentSnapshot;
  modified: DocumentSnapshot;
  originalOutlines: OutlineEntry[];
  modifiedOutlines: OutlineEntry[];
}

/**
 * Builds the public, renderer-independent comparison contract from the same
 * canonical Change[] consumed by Review Ink. No document engine objects cross
 * this boundary.
 */
export async function buildChangeSet(input: BuildChangeSetInput): Promise<ChangeSet> {
  validateExportMetadata(input.exportId, input.exportedAt);
  const [originalSha256, modifiedSha256] = await Promise.all([
    sha256Hex(input.original.bytes),
    sha256Hex(input.modified.bytes),
  ]);
  const comparisonId = await createComparisonId(
    originalSha256,
    modifiedSha256,
    CHANGE_SET_SCHEMA_VERSION,
  );
  const documents = {
    original: documentDto("original", input.original, originalSha256),
    modified: documentDto("modified", input.modified, modifiedSha256),
  } as ChangeSet["documents"];
  const originalOutlines = buildOutlineEntries("original", input.original.snapshot);
  const modifiedOutlines = buildOutlineEntries("modified", input.modified.snapshot);
  const context: ChangeBuildContext = {
    original: input.original.snapshot,
    modified: input.modified.snapshot,
    originalOutlines,
    modifiedOutlines,
  };
  const sortedChanges = [...input.changes].sort(compareChanges);
  const changeIds = new Map<Change, string>();
  sortedChanges.forEach((change, index) => changeIds.set(change, stableId("chg", index)));
  const changes = sortedChanges.map((change) => changeDto(change, changeIds.get(change)!, context));
  const outlineMappings = buildOutlineMappings(
    input.original.snapshot,
    input.modified.snapshot,
    originalOutlines,
    modifiedOutlines,
    sortedChanges,
    changeIds,
  );
  const analysis = analysisDto(input.analysis, input.generator.analysisIdentity);
  const payload: ChangeSet = {
    schemaVersion: CHANGE_SET_SCHEMA_VERSION,
    comparisonId,
    exportId: input.exportId,
    exportedAt: input.exportedAt,
    generator: {
      name: "HWPX Lens",
      version: canonicalSemVer(input.generator.version),
      lensCoreVersion: canonicalSemVer(input.generator.lensCoreVersion),
      adapterName: requiredText(input.generator.adapterName, "adapterName"),
      adapterVersion: canonicalSemVer(input.generator.adapterVersion),
      analysisIdentity: requiredText(input.generator.analysisIdentity, "analysisIdentity"),
      productProfile: requiredText(input.generator.productProfile, "productProfile"),
    },
    analysis,
    coordinateSystem: coordinateSystem(),
    fingerprintSpec: fingerprintSpec(),
    documents,
    summary: summarize(changes, outlineMappings),
    changes,
    outlineMappings,
  };
  assertJsonSafe(payload);
  return payload;
}

/** Creates the deterministic comparison identity from a canonical LF-only preimage. */
export async function createComparisonId(
  originalSha256: string,
  modifiedSha256: string,
  schemaVersion: string,
): Promise<string> {
  const original = normalizeSha256(originalSha256);
  const modified = normalizeSha256(modifiedSha256);
  const version = canonicalSemVer(schemaVersion);
  const preimage = [
    "hwpx-lens-comparison-id-v1",
    `originalSha256:${original}`,
    `modifiedSha256:${modified}`,
    `schemaVersion:${version}`,
  ].join("\n");
  const digest = await sha256Hex(new TextEncoder().encode(preimage));
  return `cmp-${digest}`;
}

export function normalizeSha256(value: string): string {
  const normalized = value.replace(/^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/gu, "").toLowerCase();
  if (!SHA256_PATTERN.test(normalized)) {
    throw new Error("SHA-256 값은 64자리 lowercase hex로 정규화할 수 있어야 합니다.");
  }
  return normalized;
}

export function canonicalSemVer(value: string): string {
  const trimmed = value.replace(/^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/gu, "");
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u.exec(trimmed);
  if (!match || match[4]?.split(".").some((part) => /^\d+$/u.test(part) && part.length > 1 && part.startsWith("0"))) {
    throw new Error(`strict SemVer 형식이 아닙니다: ${trimmed}`);
  }
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}${match[4] ?? ""}${match[5] ?? ""}`;
}

export function serializeChangeSet(changeSet: ChangeSet): string {
  assertJsonSafe(changeSet);
  return `${JSON.stringify(changeSet, null, 2).replace(/\r\n?/gu, "\n")}\n`;
}

export function sentinelizeVolatileExportFields(changeSet: ChangeSet): ChangeSet {
  return {
    ...changeSet,
    exportId: "__EXPORT_ID__",
    exportedAt: "2000-01-01T00:00:00Z",
  };
}

export function createExportId(now = new Date(), random = randomHex(6)): string {
  const date = [now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate()]
    .map((part, index) => index === 0 ? String(part) : String(part).padStart(2, "0"))
    .join("");
  return `exp-${date}-${random.toLowerCase()}`;
}

export function isoDateTimeWithOffset(date = new Date()): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

export function assertJsonSafe(value: unknown): void {
  const visit = (current: unknown, pointer: string, seen: Set<object>) => {
    if (current === undefined || typeof current === "function" || typeof current === "symbol" || typeof current === "bigint") {
      throw new Error(`JSON으로 직렬화할 수 없는 값이 있습니다: ${pointer}`);
    }
    if (typeof current === "number" && !Number.isFinite(current)) {
      throw new Error(`유한하지 않은 숫자가 있습니다: ${pointer}`);
    }
    if (typeof current === "string") {
      if (looksLikeAbsolutePath(current)) throw new Error(`로컬 절대경로가 포함되어 있습니다: ${pointer}`);
      if (looksLikeCredential(current)) throw new Error(`credential 형식의 문자열이 포함되어 있습니다: ${pointer}`);
      if (/^data:/iu.test(current)) throw new Error(`data URL은 export할 수 없습니다: ${pointer}`);
      return;
    }
    if (current === null || typeof current !== "object") return;
    if (
      current instanceof ArrayBuffer || ArrayBuffer.isView(current) ||
      (typeof Blob !== "undefined" && current instanceof Blob)
    ) {
      throw new Error(`binary object는 export할 수 없습니다: ${pointer}`);
    }
    if (seen.has(current)) throw new Error(`순환 참조가 있습니다: ${pointer}`);
    seen.add(current);
    if (Array.isArray(current)) {
      current.forEach((entry, index) => visit(entry, `${pointer}/${index}`, seen));
    } else {
      for (const [key, entry] of Object.entries(current)) visit(entry, `${pointer}/${escapePointer(key)}`, seen);
    }
    seen.delete(current);
  };
  visit(value, "", new Set());
}

function documentDto(
  side: "original" | "modified",
  input: ChangeSetDocumentInput,
  sha256: string,
): ChangeSetDocument {
  const outlines = input.snapshot.paragraphs.filter((paragraph) => paragraph.outline);
  const sectionIndexes = [
    ...input.snapshot.paragraphs.map((item) => item.sectionIndex),
    ...input.snapshot.tables.map((item) => item.sectionIndex),
    ...(input.snapshot.images ?? []).map((item) => item.sectionIndex),
  ];
  return {
    documentId: side === "original" ? "doc-original" : "doc-modified",
    role: side === "original" ? "previous" : "latest",
    fileName: baseName(input.fileName),
    byteLength: input.bytes.byteLength,
    sha256,
    mimeType: "application/hwp+zip",
    sectionCount: sectionIndexes.length ? Math.max(...sectionIndexes) + 1 : 0,
    paragraphCount: input.snapshot.paragraphs.length,
    outlineCount: outlines.length,
    tableCount: input.snapshot.tables.length,
    imageCount: input.snapshot.images?.length ?? 0,
  };
}

function analysisDto(
  provided: Partial<ChangeSetAnalysis> | undefined,
  analysisIdentity: string,
): ChangeSetAnalysis {
  const supportedTypes = normalizeTypes(provided?.supportedTypes ?? ["text", "outline", "table", "image"]);
  const completedTypes = normalizeTypes(provided?.completedTypes ?? supportedTypes);
  const status = provided?.status ?? "complete";
  const warnings = [...new Set(provided?.warnings ?? [])].sort();
  if (!analysisIdentity) throw new Error("완료된 분석 identity가 필요합니다.");
  return { status, supportedTypes, completedTypes, warnings };
}

function normalizeTypes(types: readonly ChangeSet["analysis"]["supportedTypes"][number][]) {
  const order: ChangeType[] = ["text", "outline", "table", "image"];
  return order.filter((type) => types.includes(type));
}

function coordinateSystem(): ChangeSetCoordinateSystem {
  return {
    name: "lens-semantic-snapshot",
    coordinateBase: 0,
    sectionIndexBase: 0,
    paragraphIndexBase: 0,
    tableIndexBase: 0,
    controlIndexBase: 0,
    cellIndexBase: 0,
    rowIndexBase: 0,
    columnIndexBase: 0,
    pageIndexBase: 0,
    textOffsetUnit: "utf16-code-unit",
    textRangeStart: "inclusive",
    textRangeEnd: "exclusive",
    notes: [
      "rowSpan과 columnSpan은 위치가 아니라 크기이므로 1 이상이다.",
      "classificationIndex는 화면 표시용 순번이며 1부터 시작할 수 있다.",
      "paragraphIndex는 HWPX XML child 번호가 아니라 Lens 의미 문단 번호다.",
    ],
  };
}

function fingerprintSpec(): ChangeSetFingerprintSpec {
  return {
    document: {
      algorithm: "sha256",
      input: "raw-file-bytes",
      hexCase: "lowercase",
      version: "document-sha256-v1",
    },
    text: {
      algorithm: "fnv1a-32-js-utf16",
      normalization: "NFC, control-and-zero-width-removal, collapsible-whitespace-to-single-space, trim",
      normalizationVersion: "lens-text-v1",
      hexCase: "lowercase",
    },
    table: {
      algorithm: "fnv1a-32-js-utf16",
      normalizationVersion: "lens-table-v1",
    },
    imageSource: {
      algorithm: "sha256",
      input: "original-encoded-resource-bytes",
      hexCase: "lowercase",
      version: "image-source-v1",
    },
    imageRendering: {
      algorithm: "lens-render-fingerprint",
      version: "lens-image-render-v1",
    },
  };
}

function changeDto(change: Change, id: string, context: ChangeBuildContext): ChangeSetChange {
  const original = change.kind === "added"
    ? null
    : sideDto("original", change.originalAnchor, change.originalText, context);
  const modified = change.kind === "removed"
    ? null
    : sideDto("modified", change.modifiedAnchor, change.modifiedText, context);
  const locationPath = modified?.outlinePath ?? original?.outlinePath;
  return {
    id,
    type: change.type,
    kind: change.kind,
    detail: changeDetail(change),
    locationLabel: changeLocationLabel(change, locationPath),
    mappingConfidence: lowestConfidence([
      change.originalAnchor,
      change.modifiedAnchor,
      change.originalContextAnchor,
      change.modifiedContextAnchor,
    ]),
    original,
    modified,
    originalContextAnchor: cloneAnchor(change.originalContextAnchor),
    modifiedContextAnchor: cloneAnchor(change.modifiedContextAnchor),
    data: changeData(change, context),
  };
}

function sideDto(
  side: "original" | "modified",
  anchor: DocumentAnchor | undefined,
  fallbackText: string | undefined,
  context: ChangeBuildContext,
): ChangeSetSide | null {
  if (!anchor) return null;
  const snapshot = side === "original" ? context.original : context.modified;
  const outlines = side === "original" ? context.originalOutlines : context.modifiedOutlines;
  const textInfo = textForAnchor(snapshot, anchor, fallbackText);
  return {
    ...(textInfo ? {
      text: textInfo.text,
      normalizedText: textInfo.normalizedText,
      contentFingerprint: { spec: "lens-text-v1", value: textInfo.fingerprint },
    } : {}),
    anchor: cloneAnchor(anchor)!,
    outlinePath: outlinePathForAnchor(outlines, anchor),
  };
}

function textForAnchor(
  snapshot: DocumentSnapshot,
  anchor: DocumentAnchor,
  fallbackText: string | undefined,
): { text: string; normalizedText: string; fingerprint: string } | undefined {
  if (anchor.target === "body-text") {
    const paragraph = findParagraph(snapshot, anchor.sectionIndex, anchor.paragraphIndex);
    const text = paragraph?.text ?? fallbackText;
    if (text === undefined) return undefined;
    return {
      text,
      normalizedText: normalizeParagraphText(text),
      fingerprint: paragraph?.fingerprint ?? fingerprintText(normalizeParagraphText(text)),
    };
  }
  if (anchor.target === "table-cell") {
    const cell = findCell(snapshot, anchor);
    const text = cell?.text ?? fallbackText;
    if (text === undefined) return undefined;
    return {
      text,
      normalizedText: cell?.normalizedText ?? normalizeParagraphText(text),
      fingerprint: cell?.fingerprint ?? fingerprintText(normalizeParagraphText(text)),
    };
  }
  return undefined;
}

function changeData(change: Change, context: ChangeBuildContext): ChangeSetData {
  if (change.type === "text") {
    return { segments: (change.segments ?? []).map(segmentDto) };
  }
  if (change.type === "outline") {
    return { level: change.level, outlineRelation: change.detail };
  }
  if (change.type === "table") {
    const originalTable = tableForAnchor(context.original, change.originalAnchor);
    const modifiedTable = tableForAnchor(context.modified, change.modifiedAnchor);
    const originalCell = change.originalAnchor?.target === "table-cell"
      ? findCell(context.original, change.originalAnchor)
      : undefined;
    const modifiedCell = change.modifiedAnchor?.target === "table-cell"
      ? findCell(context.modified, change.modifiedAnchor)
      : undefined;
    return {
      tableDetail: change.detail,
      originalTable: originalTable ? tableSummary(originalTable) : null,
      modifiedTable: modifiedTable ? tableSummary(modifiedTable) : null,
      originalCell: originalCell ? cellSummary(originalCell) : null,
      modifiedCell: modifiedCell ? cellSummary(modifiedCell) : null,
    };
  }
  const originalImage = imageForAnchor(context.original, change.originalAnchor);
  const modifiedImage = imageForAnchor(context.modified, change.modifiedAnchor);
  return {
    binaryChanged: change.binaryChanged,
    renderingChanged: change.renderingChanged,
    classification: change.classification,
    ...(change.captionLabel ? { captionLabel: change.captionLabel } : {}),
    originalImage: originalImage ? imageSummary(originalImage) : null,
    modifiedImage: modifiedImage ? imageSummary(modifiedImage) : null,
  };
}

function segmentDto(segment: TextChangeSegment): ChangeSetSegment {
  return {
    kind: segment.kind,
    originalRange: segment.originalRange ? { ...segment.originalRange } : null,
    modifiedRange: segment.modifiedRange ? { ...segment.modifiedRange } : null,
    ...(segment.originalBoundary !== undefined ? { originalBoundary: segment.originalBoundary } : {}),
    ...(segment.modifiedBoundary !== undefined ? { modifiedBoundary: segment.modifiedBoundary } : {}),
    ...(segment.whitespace ? { whitespace: segment.whitespace } : {}),
  };
}

function tableSummary(table: TableSnapshot): ChangeSetTableSummary {
  return {
    rowCount: table.rowCount,
    columnCount: table.columnCount,
    structureFingerprint: table.structureFingerprint,
    contentFingerprint: table.contentFingerprint,
  };
}

function cellSummary(cell: TableCellSnapshot) {
  return {
    cellIndex: cell.cellIndex,
    row: cell.row,
    column: cell.column,
    rowSpan: cell.rowSpan,
    columnSpan: cell.columnSpan,
    text: cell.text,
    fingerprint: cell.fingerprint,
  };
}

function imageSummary(image: ImageSnapshot): ChangeSetImageSummary {
  return {
    mimeType: image.mime,
    byteLength: image.byteLength,
    sourceHash: image.sourceHash,
    renderFingerprint: image.renderFingerprint,
  };
}

function buildOutlineEntries(
  side: "original" | "modified",
  snapshot: DocumentSnapshot,
): OutlineEntry[] {
  const paragraphs = snapshot.paragraphs.filter(hasOutline).sort(compareParagraphPosition);
  const stack: OutlineEntry[] = [];
  const entries: OutlineEntry[] = [];
  paragraphs.forEach((paragraph, order) => {
    while (stack.length && stack.at(-1)!.paragraph.sectionIndex !== paragraph.sectionIndex) stack.pop();
    while (stack.length && stack.at(-1)!.paragraph.outline.level >= paragraph.outline.level) stack.pop();
    const segment = pathSegment(paragraph);
    const path = {
      pathText: [...stack.map((entry) => entry.path.segments.at(-1)!), segment]
        .map((item) => item.displayText).join(" > "),
      segments: [...stack.map((entry) => entry.path.segments.at(-1)!), segment],
    };
    const next = paragraphs.slice(order + 1).find((candidate) =>
      candidate.sectionIndex > paragraph.sectionIndex ||
      (candidate.sectionIndex === paragraph.sectionIndex &&
        candidate.outline.level <= paragraph.outline.level),
    );
    const scopeEnd = next?.sectionIndex === paragraph.sectionIndex
      ? documentOrder(next.sectionIndex, next.paragraphIndex)
      : documentOrder(paragraph.sectionIndex + 1, 0);
    const entry: OutlineEntry = {
      side,
      outlineId: `${side}-outline-${String(order + 1).padStart(6, "0")}`,
      paragraph,
      order,
      path,
      parentPathKey: `section:${paragraph.sectionIndex}|${stack.map((item) =>
        `${item.paragraph.outline.level}:${item.titleFingerprint}`,
      ).join("/")}`,
      titleFingerprint: fingerprintText(paragraph.normalizedText),
      contentFingerprint: fingerprintScope(snapshot, paragraph, scopeEnd),
      scopeStart: documentOrder(paragraph.sectionIndex, paragraph.paragraphIndex),
      scopeEnd,
    };
    entries.push(entry);
    stack.push(entry);
  });
  return entries;
}

function fingerprintScope(
  snapshot: DocumentSnapshot,
  outline: OutlineParagraph,
  scopeEnd: number,
): string {
  const start = documentOrder(outline.sectionIndex, outline.paragraphIndex);
  const paragraphs = snapshot.paragraphs
    .filter((item) => !item.outline && inDocumentRange(item.sectionIndex, item.paragraphIndex, start, scopeEnd))
    .sort(compareParagraphPosition)
    .map((item) => `p:${item.fingerprint}:${item.normalizedText}`);
  const tables = snapshot.tables
    .filter((item) => inDocumentRange(item.sectionIndex, item.paragraphIndex, start, scopeEnd))
    .sort(compareTablePosition)
    .map((item) => `t:${item.structureFingerprint}:${item.contentFingerprint}`);
  const images = (snapshot.images ?? [])
    .filter((item) => inDocumentRange(item.sectionIndex, item.paragraphIndex, start, scopeEnd))
    .sort(compareImagePosition)
    .map((item) => `i:${item.sourceHash}:${item.renderFingerprint}`);
  return fingerprintText([...paragraphs, ...tables, ...images].join("\u001e"));
}

function buildOutlineMappings(
  original: DocumentSnapshot,
  modified: DocumentSnapshot,
  originalEntries: OutlineEntry[],
  modifiedEntries: OutlineEntry[],
  changes: readonly Change[],
  changeIds: ReadonlyMap<Change, string>,
): ChangeSetOutlineMapping[] {
  const originalByParagraph = new Map(originalEntries.map((entry) => [paragraphKey(entry.paragraph), entry]));
  const modifiedByParagraph = new Map(modifiedEntries.map((entry) => [paragraphKey(entry.paragraph), entry]));
  const duplicateOriginal = duplicateTitleKeys(originalEntries);
  const duplicateModified = duplicateTitleKeys(modifiedEntries);
  return alignOutlineSnapshots(original, modified).map((step, index) => {
    const before = step.original ? originalByParagraph.get(paragraphKey(step.original)) : undefined;
    const after = step.modified ? modifiedByParagraph.get(paragraphKey(step.modified)) : undefined;
    if (!before && !after) throw new Error("목차 대응 단계가 비어 있습니다.");
    const related = changes
      .filter((change) => changeInEitherScope(change, before, after))
      .map((change) => changeIds.get(change)!)
      .sort();
    const relations = mappingRelations(before, after, changes);
    const evidence = mappingEvidence(before, after);
    const mappingConfidence = mappingConfidenceFor(
      before,
      after,
      duplicateOriginal,
      duplicateModified,
    );
    const exactEquality = before && after &&
      before.titleFingerprint === after.titleFingerprint &&
      before.contentFingerprint === after.contentFingerprint;
    return {
      id: stableId("map", index),
      relations,
      mappingConfidence,
      ...(exactEquality ? { similarity: 1 } : {}),
      matchEvidence: evidence,
      relatedChangeIds: related,
      original: before ? outlineMappingSide(before) : null,
      modified: after ? outlineMappingSide(after) : null,
    };
  });
}

function mappingRelations(
  before: OutlineEntry | undefined,
  after: OutlineEntry | undefined,
  changes: readonly Change[],
): OutlineRelation[] {
  if (!before) return ["added"];
  if (!after) return ["removed"];
  const relations: OutlineRelation[] = [];
  if (before.parentPathKey !== after.parentPathKey) relations.push("moved");
  if (before.titleFingerprint !== after.titleFingerprint) relations.push("renamed");
  if (changes.some((change) => change.type !== "outline" && changeInEitherScope(change, before, after))) {
    relations.push("modified");
  }
  return relations.length ? RELATION_ORDER.filter((relation) => relations.includes(relation)) : ["unchanged"];
}

function mappingEvidence(before?: OutlineEntry, after?: OutlineEntry): string[] {
  if (!before || !after) return ["aligned-by-existing-engine"];
  const evidence = ["aligned-by-existing-engine"];
  if (before.paragraph.outline.level === after.paragraph.outline.level) evidence.unshift("same-level");
  if (before.paragraph.outline.number === after.paragraph.outline.number) evidence.push("same-number");
  if (before.titleFingerprint === after.titleFingerprint) evidence.push("same-title-fingerprint");
  if (before.contentFingerprint === after.contentFingerprint) evidence.push("same-content-fingerprint");
  evidence.push(before.parentPathKey === after.parentPathKey ? "same-parent-path" : "different-parent-path");
  return evidence;
}

function mappingConfidenceFor(
  before: OutlineEntry | undefined,
  after: OutlineEntry | undefined,
  originalDuplicates: ReadonlySet<string>,
  modifiedDuplicates: ReadonlySet<string>,
): MappingConfidence {
  if (!before || !after) return "contextual";
  const keyBefore = duplicateKey(before);
  const keyAfter = duplicateKey(after);
  if (originalDuplicates.has(keyBefore) || modifiedDuplicates.has(keyAfter)) return "approximate";
  if (
    before.paragraph.outline.level === after.paragraph.outline.level &&
    before.titleFingerprint === after.titleFingerprint
  ) return "exact";
  if (
    before.paragraph.outline.level === after.paragraph.outline.level &&
    before.paragraph.outline.number === after.paragraph.outline.number
  ) return "contextual";
  return "approximate";
}

function outlineMappingSide(entry: OutlineEntry): OutlineMappingSide {
  const paragraph = entry.paragraph;
  return {
    outlineId: entry.outlineId,
    level: paragraph.outline.level,
    number: paragraph.outline.number,
    title: paragraph.text,
    displayText: `${paragraph.outline.number} ${paragraph.text}`.trim(),
    titleFingerprint: entry.titleFingerprint,
    contentFingerprint: entry.contentFingerprint,
    anchor: cloneAnchor(wholeOutlineAnchor(paragraph))!,
    path: clonePath(entry.path),
  };
}

function summarize(
  changes: readonly ChangeSetChange[],
  outlineMappings: readonly ChangeSetOutlineMapping[],
): ChangeSetSummary {
  const byKind = { added: 0, removed: 0, modified: 0 };
  const byType = { text: 0, outline: 0, table: 0, image: 0 };
  const outlineRelations = {
    unchanged: 0,
    moved: 0,
    renamed: 0,
    modified: 0,
    added: 0,
    removed: 0,
  };
  changes.forEach((change) => {
    byKind[change.kind] += 1;
    byType[change.type] += 1;
  });
  outlineMappings.forEach((mapping) => mapping.relations.forEach((relation) => {
    outlineRelations[relation] += 1;
  }));
  return {
    totalChanges: changes.length,
    byKind,
    byType,
    outlineMappingCount: outlineMappings.length,
    outlineRelations,
  };
}

function compareChanges(left: Change, right: Change): number {
  const leftAnchor = primaryAnchor(left);
  const rightAnchor = primaryAnchor(right);
  const leftPosition = anchorSortKey(leftAnchor);
  const rightPosition = anchorSortKey(rightAnchor);
  for (let index = 0; index < leftPosition.length; index += 1) {
    if (leftPosition[index] !== rightPosition[index]) return leftPosition[index] - rightPosition[index];
  }
  return TYPE_ORDER[left.type] - TYPE_ORDER[right.type] ||
    compareStrings(changeDetail(left), changeDetail(right)) ||
    compareStrings(left.kind, right.kind) ||
    compareStrings(stableChangeTieBreaker(left), stableChangeTieBreaker(right));
}

function primaryAnchor(change: Change): DocumentAnchor | undefined {
  if (change.kind === "added") return change.modifiedAnchor ?? change.modifiedContextAnchor;
  return change.originalAnchor ?? change.modifiedAnchor ?? change.originalContextAnchor ?? change.modifiedContextAnchor;
}

function anchorSortKey(anchor?: DocumentAnchor): number[] {
  if (!anchor) return Array(8).fill(Number.MAX_SAFE_INTEGER);
  const paragraph = anchor.paragraphIndex;
  const control = anchor.target === "table" || anchor.target === "table-cell"
    ? anchor.controlIndex
    : -1;
  const table = anchor.target === "table" || anchor.target === "table-cell" ? anchor.tableIndex : -1;
  const image = anchor.target === "image" ? anchor.imageIndex : -1;
  const cell = anchor.target === "table-cell" ? anchor.cellIndex : -1;
  const offset = anchor.target === "body-text" ? anchor.textRange?.start ?? 0 : 0;
  return [anchor.sectionIndex, paragraph, control, table, image, cell, offset, 0];
}

function stableChangeTieBreaker(change: Change): string {
  return [
    change.originalText ?? "",
    change.modifiedText ?? "",
    anchorIdentity(change.originalAnchor),
    anchorIdentity(change.modifiedAnchor),
  ].join("\u0000");
}

function changeDetail(change: Change): string {
  if (change.type === "text") return change.detail ?? "content";
  return change.detail;
}

function changeLocationLabel(change: Change, path?: OutlinePath): string {
  if ("locationLabel" in change) return change.locationLabel;
  return path?.segments.at(-1)?.displayText ?? "문서 본문";
}

function lowestConfidence(anchors: Array<DocumentAnchor | undefined>): MappingConfidence {
  const values = anchors.filter((anchor): anchor is DocumentAnchor => Boolean(anchor));
  if (!values.length) return "approximate";
  return values.reduce((lowest, anchor) =>
    CONFIDENCE_ORDER[anchor.confidence] < CONFIDENCE_ORDER[lowest]
      ? anchor.confidence
      : lowest,
  values[0].confidence);
}

function outlinePathForAnchor(entries: readonly OutlineEntry[], anchor: DocumentAnchor): OutlinePath {
  const position = documentOrder(anchor.sectionIndex, anchor.paragraphIndex);
  const entry = [...entries].reverse().find((item) => position >= item.scopeStart && position < item.scopeEnd);
  return entry ? clonePath(entry.path) : { pathText: "", segments: [] };
}

function changeInEitherScope(
  change: Change,
  original: OutlineEntry | undefined,
  modified: OutlineEntry | undefined,
): boolean {
  return Boolean(
    (original && anchorInScope(change.originalAnchor, original)) ||
    (modified && anchorInScope(change.modifiedAnchor, modified)),
  );
}

function anchorInScope(anchor: DocumentAnchor | undefined, entry: OutlineEntry): boolean {
  if (!anchor) return false;
  const position = documentOrder(anchor.sectionIndex, anchor.paragraphIndex);
  return position >= entry.scopeStart && position < entry.scopeEnd;
}

function wholeOutlineAnchor(paragraph: OutlineParagraph): DocumentAnchor {
  return {
    target: "body-text",
    sectionIndex: paragraph.sectionIndex,
    paragraphIndex: paragraph.paragraphIndex,
    textRange: { start: 0, end: paragraph.text.length },
    textFingerprint: paragraph.fingerprint,
    generatedPrefix: {
      text: paragraph.outline.number,
      pageIndex: paragraph.outline.pageIndex,
    },
    confidence: "exact",
  };
}

function cloneAnchor(anchor: DocumentAnchor | undefined): DocumentAnchor | null {
  if (!anchor) return null;
  if (anchor.target === "body-text") {
    return {
      target: "body-text",
      sectionIndex: anchor.sectionIndex,
      paragraphIndex: anchor.paragraphIndex,
      ...(anchor.textRange ? { textRange: { ...anchor.textRange } } : {}),
      ...(anchor.textFingerprint ? { textFingerprint: anchor.textFingerprint } : {}),
      ...(anchor.contextFingerprint ? { contextFingerprint: anchor.contextFingerprint } : {}),
      ...(anchor.generatedPrefix ? { generatedPrefix: { ...anchor.generatedPrefix } } : {}),
      confidence: anchor.confidence,
    };
  }
  if (anchor.target === "table") {
    return {
      target: "table",
      sectionIndex: anchor.sectionIndex,
      paragraphIndex: anchor.paragraphIndex,
      controlIndex: anchor.controlIndex,
      tableIndex: anchor.tableIndex,
      confidence: anchor.confidence,
    };
  }
  if (anchor.target === "table-cell") {
    return {
      target: "table-cell",
      sectionIndex: anchor.sectionIndex,
      paragraphIndex: anchor.paragraphIndex,
      controlIndex: anchor.controlIndex,
      tableIndex: anchor.tableIndex,
      cellIndex: anchor.cellIndex,
      row: anchor.row,
      column: anchor.column,
      rowSpan: anchor.rowSpan,
      columnSpan: anchor.columnSpan,
      ...(anchor.textFingerprint ? { textFingerprint: anchor.textFingerprint } : {}),
      confidence: anchor.confidence,
    };
  }
  return {
    target: "image",
    sectionIndex: anchor.sectionIndex,
    paragraphIndex: anchor.paragraphIndex,
    imageIndex: anchor.imageIndex,
    stableKey: anchor.stableKey,
    rect: { ...anchor.rect },
    confidence: anchor.confidence,
  };
}

function clonePath(path: OutlinePath): OutlinePath {
  return {
    pathText: path.pathText,
    segments: path.segments.map((segment) => ({ ...segment })),
  };
}

function pathSegment(paragraph: OutlineParagraph): OutlinePathSegment {
  return {
    level: paragraph.outline.level,
    number: paragraph.outline.number,
    title: paragraph.text,
    displayText: `${paragraph.outline.number} ${paragraph.text}`.trim(),
  };
}

function findParagraph(snapshot: DocumentSnapshot, sectionIndex: number, paragraphIndex: number) {
  return snapshot.paragraphs.find((paragraph) =>
    paragraph.sectionIndex === sectionIndex && paragraph.paragraphIndex === paragraphIndex,
  );
}

function tableForAnchor(snapshot: DocumentSnapshot, anchor?: DocumentAnchor): TableSnapshot | undefined {
  if (!anchor || (anchor.target !== "table" && anchor.target !== "table-cell")) return undefined;
  return snapshot.tables.find((table) =>
    table.sectionIndex === anchor.sectionIndex && table.tableIndex === anchor.tableIndex,
  );
}

function findCell(snapshot: DocumentSnapshot, anchor: Extract<DocumentAnchor, { target: "table-cell" }>) {
  return tableForAnchor(snapshot, anchor)?.cells.find((cell) => cell.cellIndex === anchor.cellIndex);
}

function imageForAnchor(snapshot: DocumentSnapshot, anchor?: DocumentAnchor): ImageSnapshot | undefined {
  if (!anchor || anchor.target !== "image") return undefined;
  return (snapshot.images ?? []).find((image) =>
    image.sectionIndex === anchor.sectionIndex &&
    image.imageIndex === anchor.imageIndex &&
    image.stableKey === anchor.stableKey,
  );
}

function duplicateTitleKeys(entries: readonly OutlineEntry[]): Set<string> {
  const counts = new Map<string, number>();
  entries.forEach((entry) => counts.set(duplicateKey(entry), (counts.get(duplicateKey(entry)) ?? 0) + 1));
  return new Set([...counts].filter(([, count]) => count > 1).map(([key]) => key));
}

function duplicateKey(entry: OutlineEntry): string {
  return `${entry.paragraph.outline.level}:${entry.titleFingerprint}`;
}

function paragraphKey(paragraph: Pick<ParagraphSnapshot, "sectionIndex" | "paragraphIndex">): string {
  return `${paragraph.sectionIndex}:${paragraph.paragraphIndex}`;
}

function anchorIdentity(anchor?: DocumentAnchor): string {
  return anchor ? anchorSortKey(anchor).join(":") : "";
}

function compareParagraphPosition(left: ParagraphSnapshot, right: ParagraphSnapshot): number {
  return left.sectionIndex - right.sectionIndex || left.paragraphIndex - right.paragraphIndex;
}

function compareTablePosition(left: TableSnapshot, right: TableSnapshot): number {
  return left.sectionIndex - right.sectionIndex || left.paragraphIndex - right.paragraphIndex || left.tableIndex - right.tableIndex;
}

function compareImagePosition(left: ImageSnapshot, right: ImageSnapshot): number {
  return left.sectionIndex - right.sectionIndex || left.paragraphIndex - right.paragraphIndex || left.imageIndex - right.imageIndex;
}

function inDocumentRange(sectionIndex: number, paragraphIndex: number, start: number, end: number): boolean {
  const position = documentOrder(sectionIndex, paragraphIndex);
  return position > start && position < end;
}

function documentOrder(sectionIndex: number, paragraphIndex: number): number {
  return sectionIndex * 10_000_000 + paragraphIndex;
}

function stableId(prefix: "chg" | "map", zeroBasedIndex: number): string {
  return `${prefix}-${String(zeroBasedIndex + 1).padStart(6, "0")}`;
}

function baseName(fileName: string): string {
  const value = fileName.split(/[\\/]/u).at(-1)?.trim() ?? "";
  if (!value) throw new Error("파일 basename이 비어 있습니다.");
  return value;
}

function validateExportMetadata(exportId: string, exportedAt: string): void {
  requiredText(exportId, "exportId");
  if (Number.isNaN(Date.parse(exportedAt)) || !/(?:Z|[+-]\d{2}:\d{2})$/u.test(exportedAt)) {
    throw new Error("exportedAt은 timezone offset이 포함된 ISO 8601 값이어야 합니다.");
  }
}

function requiredText(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} 값이 비어 있습니다.`);
  return trimmed;
}

function randomHex(length: number): string {
  const bytes = new Uint8Array(Math.ceil(length / 2));
  if (!globalThis.crypto) throw new Error("안전한 exportId를 만들 수 없습니다.");
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, length);
}

function looksLikeAbsolutePath(value: string): boolean {
  return /^(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|root|tmp|var|etc)(?:\/|$))/u.test(value);
}

function looksLikeCredential(value: string): boolean {
  return /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*\S+)/iu.test(value);
}

function escapePointer(value: string): string {
  return value.replace(/~/gu, "~0").replace(/\//gu, "~1");
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function hasOutline(paragraph: ParagraphSnapshot): paragraph is OutlineParagraph {
  return paragraph.outline !== undefined;
}

export const CHANGE_SET_FINGERPRINT_PATTERNS = {
  sha256: SHA256_PATTERN,
  text: FINGERPRINT_PATTERN,
} as const;
