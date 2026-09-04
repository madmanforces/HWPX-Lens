import { sha256Hex } from "./ephemeral-cache";
import { fingerprintText, normalizeParagraphText } from "./text";
import type { DocumentAnchor, DocumentSnapshot, ParagraphSnapshot } from "./types";
import type {
  ChangeSet,
  ChangeSetChange,
  ChangeSetOutlineMapping,
  ChangeSetSide,
  OutlineMappingSide,
  OutlinePath,
  OutlineRelation,
} from "./change-set-types";
import {
  CHANGE_SET_FINGERPRINT_PATTERNS,
  assertJsonSafe,
  createComparisonId,
} from "./change-set";

export interface ChangeSetIntegrityContext {
  originalBytes?: Uint8Array;
  modifiedBytes?: Uint8Array;
  originalSnapshot?: DocumentSnapshot;
  modifiedSnapshot?: DocumentSnapshot;
  expectedSupportedTypes?: readonly string[];
  expectedCompletedTypes?: readonly string[];
}

export async function assertChangeSetIntegrity(
  payload: ChangeSet,
  context: ChangeSetIntegrityContext = {},
): Promise<void> {
  const issues = await validateChangeSetIntegrity(payload, context);
  if (issues.length) {
    throw new Error(`Change Set 무결성 검증 실패 (${issues.length}): ${issues.slice(0, 5).join("; ")}`);
  }
}

export async function validateChangeSetIntegrity(
  payload: ChangeSet,
  context: ChangeSetIntegrityContext = {},
): Promise<string[]> {
  const issues: string[] = [];
  try {
    assertJsonSafe(payload);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : "payload safety validation failed");
  }

  const recalculated = await createComparisonId(
    payload.documents.original.sha256,
    payload.documents.modified.sha256,
    payload.schemaVersion,
  ).catch(() => "invalid");
  if (payload.comparisonId !== recalculated) issues.push("comparisonId가 canonical 입력과 일치하지 않습니다.");
  if (payload.documents.original.role !== "previous") issues.push("Original role은 previous여야 합니다.");
  if (payload.documents.modified.role !== "latest") issues.push("Modified role은 latest여야 합니다.");

  await validateRawDocument(
    "original",
    payload.documents.original.sha256,
    payload.documents.original.byteLength,
    context.originalBytes,
    issues,
  );
  await validateRawDocument(
    "modified",
    payload.documents.modified.sha256,
    payload.documents.modified.byteLength,
    context.modifiedBytes,
    issues,
  );

  validateAnalysis(payload, context, issues);
  validateUniqueIds(payload.changes.map((item) => item.id), "change", issues);
  validateUniqueIds(payload.outlineMappings.map((item) => item.id), "outline mapping", issues);
  validateSummary(payload, issues);

  const changeIds = new Set(payload.changes.map((item) => item.id));
  payload.outlineMappings.forEach((mapping) => {
    mapping.relatedChangeIds.forEach((id) => {
      if (!changeIds.has(id)) issues.push(`${mapping.id}의 relatedChangeId ${id}가 존재하지 않습니다.`);
    });
    validateMapping(mapping, issues);
  });

  const originalPaths = context.originalSnapshot
    ? expectedOutlineEntries("original", context.originalSnapshot)
    : [];
  const modifiedPaths = context.modifiedSnapshot
    ? expectedOutlineEntries("modified", context.modifiedSnapshot)
    : [];

  payload.changes.forEach((change) => validateChange(
    change,
    context.originalSnapshot,
    context.modifiedSnapshot,
    originalPaths,
    modifiedPaths,
    issues,
  ));

  if (context.originalSnapshot) {
    validateDocumentFacts(payload, "original", context.originalSnapshot, issues);
    validateOutlineCoverage(payload, "original", originalPaths, issues);
  }
  if (context.modifiedSnapshot) {
    validateDocumentFacts(payload, "modified", context.modifiedSnapshot, issues);
    validateOutlineCoverage(payload, "modified", modifiedPaths, issues);
  }
  validateRelatedChangeScopes(payload, originalPaths, modifiedPaths, issues);
  return issues;
}

async function validateRawDocument(
  side: string,
  expectedHash: string,
  expectedLength: number,
  bytes: Uint8Array | undefined,
  issues: string[],
) {
  if (!bytes) return;
  if (bytes.byteLength !== expectedLength) issues.push(`${side} raw byteLength가 일치하지 않습니다.`);
  if (await sha256Hex(bytes) !== expectedHash) issues.push(`${side} raw SHA-256이 일치하지 않습니다.`);
}

function validateAnalysis(
  payload: ChangeSet,
  context: ChangeSetIntegrityContext,
  issues: string[],
) {
  const supported = payload.analysis.supportedTypes;
  const completed = payload.analysis.completedTypes;
  if (completed.some((type) => !supported.includes(type))) {
    issues.push("completedTypes에는 supportedTypes에 없는 값이 들어갈 수 없습니다.");
  }
  if (payload.analysis.status === "complete" && supported.some((type) => !completed.includes(type))) {
    issues.push("complete 분석은 모든 supportedTypes를 완료해야 합니다.");
  }
  if (context.expectedSupportedTypes &&
    !sameStringSet(supported, context.expectedSupportedTypes)) {
    issues.push("supportedTypes가 실제 DiffAdapter와 일치하지 않습니다.");
  }
  if (context.expectedCompletedTypes &&
    !sameStringSet(completed, context.expectedCompletedTypes)) {
    issues.push("completedTypes가 실제 분석 결과와 일치하지 않습니다.");
  }
}

function validateUniqueIds(ids: readonly string[], label: string, issues: string[]) {
  if (new Set(ids).size !== ids.length) issues.push(`${label} ID가 중복되었습니다.`);
}

function validateSummary(payload: ChangeSet, issues: string[]) {
  const expectedKinds = { added: 0, removed: 0, modified: 0 };
  const expectedTypes = { text: 0, outline: 0, table: 0, image: 0 };
  payload.changes.forEach((change) => {
    expectedKinds[change.kind] += 1;
    expectedTypes[change.type] += 1;
  });
  const expectedRelations = {
    unchanged: 0,
    moved: 0,
    renamed: 0,
    modified: 0,
    added: 0,
    removed: 0,
  };
  payload.outlineMappings.forEach((mapping) => mapping.relations.forEach((relation) => {
    expectedRelations[relation] += 1;
  }));
  if (payload.summary.totalChanges !== payload.changes.length) issues.push("summary.totalChanges가 다릅니다.");
  if (JSON.stringify(payload.summary.byKind) !== JSON.stringify(expectedKinds)) issues.push("summary.byKind가 다릅니다.");
  if (JSON.stringify(payload.summary.byType) !== JSON.stringify(expectedTypes)) issues.push("summary.byType이 다릅니다.");
  if (payload.summary.outlineMappingCount !== payload.outlineMappings.length) issues.push("summary.outlineMappingCount가 다릅니다.");
  if (JSON.stringify(payload.summary.outlineRelations) !== JSON.stringify(expectedRelations)) issues.push("summary.outlineRelations가 다릅니다.");
}

function validateMapping(mapping: ChangeSetOutlineMapping, issues: string[]) {
  const relationSet = new Set(mapping.relations);
  if (relationSet.size !== mapping.relations.length) issues.push(`${mapping.id} relations가 중복되었습니다.`);
  if ((relationSet.has("added") || relationSet.has("removed")) && relationSet.size !== 1) {
    issues.push(`${mapping.id} added/removed는 다른 relation과 함께 쓸 수 없습니다.`);
  }
  if (relationSet.has("unchanged") && relationSet.size !== 1) {
    issues.push(`${mapping.id} unchanged는 다른 relation과 함께 쓸 수 없습니다.`);
  }
  if (relationSet.has("added") && (mapping.original !== null || mapping.modified === null)) {
    issues.push(`${mapping.id} added side 규칙이 잘못되었습니다.`);
  } else if (relationSet.has("removed") && (mapping.original === null || mapping.modified !== null)) {
    issues.push(`${mapping.id} removed side 규칙이 잘못되었습니다.`);
  } else if (!relationSet.has("added") && !relationSet.has("removed") &&
    (mapping.original === null || mapping.modified === null)) {
    issues.push(`${mapping.id} paired mapping은 양쪽 side가 필요합니다.`);
  }
  if (mapping.similarity !== undefined && (!Number.isFinite(mapping.similarity) || mapping.similarity < 0 || mapping.similarity > 1)) {
    issues.push(`${mapping.id} similarity 범위가 잘못되었습니다.`);
  }
  validateMappingRelationMeaning(mapping, relationSet, issues);
  if (mapping.original) validateOutlineMappingSide(mapping.id, mapping.original, issues);
  if (mapping.modified) validateOutlineMappingSide(mapping.id, mapping.modified, issues);
}

function validateMappingRelationMeaning(
  mapping: ChangeSetOutlineMapping,
  relations: ReadonlySet<OutlineRelation>,
  issues: string[],
) {
  if (!mapping.original || !mapping.modified) return;
  const titleChanged = mapping.original.titleFingerprint !== mapping.modified.titleFingerprint;
  const parentChanged = parentPathKey(mapping.original) !== parentPathKey(mapping.modified);
  if (relations.has("renamed") !== titleChanged) issues.push(`${mapping.id} renamed relation과 제목 지문이 모순됩니다.`);
  if (relations.has("moved") !== parentChanged) issues.push(`${mapping.id} moved relation과 부모 경로가 모순됩니다.`);
  if (relations.has("unchanged") && (
    titleChanged || parentChanged ||
    mapping.original.contentFingerprint !== mapping.modified.contentFingerprint
  )) issues.push(`${mapping.id} unchanged relation이 실제 내용과 모순됩니다.`);
}

function validateOutlineMappingSide(id: string, side: OutlineMappingSide, issues: string[]) {
  if (!CHANGE_SET_FINGERPRINT_PATTERNS.text.test(side.titleFingerprint) ||
    !CHANGE_SET_FINGERPRINT_PATTERNS.text.test(side.contentFingerprint)) {
    issues.push(`${id} 목차 fingerprint 형식이 잘못되었습니다.`);
  }
  if (side.titleFingerprint !== fingerprintText(normalizeParagraphText(side.title))) {
    issues.push(`${id} titleFingerprint가 title과 일치하지 않습니다.`);
  }
  validatePath(side.path, side, `${id} outline path`, issues);
}

function validateChange(
  change: ChangeSetChange,
  originalSnapshot: DocumentSnapshot | undefined,
  modifiedSnapshot: DocumentSnapshot | undefined,
  originalOutlines: readonly ExpectedOutlineEntry[],
  modifiedOutlines: readonly ExpectedOutlineEntry[],
  issues: string[],
) {
  if (change.kind === "added" && (change.original !== null || change.modified === null)) {
    issues.push(`${change.id} added side 규칙이 잘못되었습니다.`);
  } else if (change.kind === "removed" && (change.original === null || change.modified !== null)) {
    issues.push(`${change.id} removed side 규칙이 잘못되었습니다.`);
  } else if (change.kind === "modified" && (change.original === null || change.modified === null)) {
    issues.push(`${change.id} modified side 규칙이 잘못되었습니다.`);
  }
  validateDetail(change, issues);
  const confidenceRank = { approximate: 0, contextual: 1, exact: 2 } as const;
  const anchors = [
    change.original?.anchor,
    change.modified?.anchor,
    change.originalContextAnchor,
    change.modifiedContextAnchor,
  ].filter((anchor): anchor is DocumentAnchor => Boolean(anchor));
  const expectedConfidence = anchors.reduce((lowest, anchor) =>
    confidenceRank[anchor.confidence] < confidenceRank[lowest]
      ? anchor.confidence
      : lowest,
  anchors[0]?.confidence ?? "approximate");
  if (change.mappingConfidence !== expectedConfidence) {
    issues.push(`${change.id} mappingConfidence가 관련 Anchor의 최저 신뢰도와 다릅니다.`);
  }
  if (change.original) validateSide(change.id, change.original, originalSnapshot, originalOutlines, issues);
  if (change.modified) validateSide(change.id, change.modified, modifiedSnapshot, modifiedOutlines, issues);
  validateAnchor(change.originalContextAnchor, originalSnapshot, `${change.id}.originalContextAnchor`, issues);
  validateAnchor(change.modifiedContextAnchor, modifiedSnapshot, `${change.id}.modifiedContextAnchor`, issues);
  if (change.type === "text") validateSegments(change, issues);
  if (change.type === "table") validateTableData(change, originalSnapshot, modifiedSnapshot, issues);
  if (change.type === "image") validateImageData(change, originalSnapshot, modifiedSnapshot, issues);
}

function validateDetail(change: ChangeSetChange, issues: string[]) {
  const allowed = {
    text: ["content", "whitespace"],
    outline: ["renamed", "outline-added", "outline-removed", "outline-moved"],
    table: ["cell-text", "structure", "table-added", "table-removed"],
    image: ["image-added", "image-removed", "image-changed"],
  }[change.type];
  if (!allowed.includes(change.detail)) issues.push(`${change.id} detail이 type과 맞지 않습니다.`);
  const addedDetails = new Set(["outline-added", "table-added", "image-added"]);
  const removedDetails = new Set(["outline-removed", "table-removed", "image-removed"]);
  if (addedDetails.has(change.detail) && change.kind !== "added") {
    issues.push(`${change.id} added detail과 kind가 모순됩니다.`);
  }
  if (removedDetails.has(change.detail) && change.kind !== "removed") {
    issues.push(`${change.id} removed detail과 kind가 모순됩니다.`);
  }
  if (change.type === "outline" && "outlineRelation" in change.data &&
    change.data.outlineRelation !== change.detail) {
    issues.push(`${change.id} outline data가 detail과 다릅니다.`);
  }
  if (change.type === "table" && "tableDetail" in change.data &&
    change.data.tableDetail !== change.detail) {
    issues.push(`${change.id} table data가 detail과 다릅니다.`);
  }
}

function validateSide(
  id: string,
  side: ChangeSetSide,
  snapshot: DocumentSnapshot | undefined,
  outlines: readonly ExpectedOutlineEntry[],
  issues: string[],
) {
  validateAnchor(side.anchor, snapshot, `${id}.side.anchor`, issues);
  if (side.text !== undefined) {
    const normalized = side.anchor.target === "table-cell" && snapshot
      ? findCell(snapshot, side.anchor)?.normalizedText ?? normalizeParagraphText(side.text)
      : normalizeParagraphText(side.text);
    if (side.normalizedText !== normalized) issues.push(`${id} normalizedText가 text와 일치하지 않습니다.`);
    if (!side.contentFingerprint || side.contentFingerprint.spec !== "lens-text-v1" ||
      side.contentFingerprint.value !== fingerprintText(normalized)) {
      issues.push(`${id} contentFingerprint가 normalizedText와 일치하지 않습니다.`);
    }
  } else if (side.normalizedText !== undefined || side.contentFingerprint !== undefined) {
    issues.push(`${id} text 없이 normalizedText/fingerprint가 있습니다.`);
  }
  const expectedPath = pathForAnchor(outlines, side.anchor);
  if (JSON.stringify(side.outlinePath) !== JSON.stringify(expectedPath)) {
    issues.push(`${id} outlinePath가 snapshot의 전체 경로와 일치하지 않습니다.`);
  }
}

function validateAnchor(
  anchor: DocumentAnchor | null,
  snapshot: DocumentSnapshot | undefined,
  label: string,
  issues: string[],
) {
  if (!anchor || !snapshot) return;
  if (![anchor.sectionIndex, anchor.paragraphIndex].every((value) => Number.isInteger(value) && value >= 0)) {
    issues.push(`${label} index가 음수이거나 정수가 아닙니다.`);
    return;
  }
  if (anchor.target === "body-text") {
    const paragraph = findParagraph(snapshot, anchor.sectionIndex, anchor.paragraphIndex);
    if (!paragraph) {
      issues.push(`${label} 문단이 snapshot에 없습니다.`);
      return;
    }
    if (anchor.textRange && (!validRange(anchor.textRange, paragraph.text.length))) {
      issues.push(`${label} textRange가 문단 범위를 벗어납니다.`);
    }
    if (anchor.textFingerprint && anchor.textFingerprint !== paragraph.fingerprint) {
      issues.push(`${label} textFingerprint가 snapshot과 다릅니다.`);
    }
    return;
  }
  if (anchor.target === "table" || anchor.target === "table-cell") {
    const table = snapshot.tables.find((item) =>
      item.sectionIndex === anchor.sectionIndex && item.tableIndex === anchor.tableIndex,
    );
    if (!table) issues.push(`${label} table이 snapshot에 없습니다.`);
    if (anchor.target === "table-cell") {
      const cell = table?.cells.find((item) => item.cellIndex === anchor.cellIndex);
      if (!cell) issues.push(`${label} cell이 snapshot에 없습니다.`);
      if (anchor.rowSpan < 1 || anchor.columnSpan < 1) issues.push(`${label} span은 1 이상이어야 합니다.`);
      if (cell && anchor.textFingerprint && cell.fingerprint !== anchor.textFingerprint) {
        issues.push(`${label} cell fingerprint가 snapshot과 다릅니다.`);
      }
    }
    return;
  }
  const image = (snapshot.images ?? []).find((item) =>
    item.sectionIndex === anchor.sectionIndex &&
    item.imageIndex === anchor.imageIndex &&
    item.stableKey === anchor.stableKey,
  );
  if (!image) issues.push(`${label} image가 snapshot에 없습니다.`);
  if ([anchor.rect.x, anchor.rect.y, anchor.rect.width, anchor.rect.height].some((value) => !Number.isFinite(value)) ||
    anchor.rect.width < 0 || anchor.rect.height < 0) issues.push(`${label} image rect가 유효하지 않습니다.`);
}

function validateSegments(change: ChangeSetChange, issues: string[]) {
  if (!("segments" in change.data) || !Array.isArray(change.data.segments)) {
    issues.push(`${change.id} text data에 segments가 없습니다.`);
    return;
  }
  const originalLength = change.original?.text?.length;
  const modifiedLength = change.modified?.text?.length;
  change.data.segments.forEach((segment, index) => {
    if (segment.originalRange && !validRange(segment.originalRange, originalLength)) {
      issues.push(`${change.id} segment ${index} originalRange가 잘못되었습니다.`);
    }
    if (segment.modifiedRange && !validRange(segment.modifiedRange, modifiedLength)) {
      issues.push(`${change.id} segment ${index} modifiedRange가 잘못되었습니다.`);
    }
  });
}

function validateImageData(
  change: ChangeSetChange,
  originalSnapshot: DocumentSnapshot | undefined,
  modifiedSnapshot: DocumentSnapshot | undefined,
  issues: string[],
) {
  if (!("originalImage" in change.data)) return;
  for (const [side, snapshot, changeSide, data] of [
    ["original", originalSnapshot, change.original, change.data.originalImage],
    ["modified", modifiedSnapshot, change.modified, change.data.modifiedImage],
  ] as const) {
    if (!changeSide || changeSide.anchor.target !== "image" || !snapshot || !data) continue;
    const anchor = changeSide.anchor;
    const image = (snapshot.images ?? []).find((item) =>
      item.imageIndex === anchor.imageIndex && item.stableKey === anchor.stableKey,
    );
    if (!image || image.sourceHash !== data.sourceHash || image.byteLength !== data.byteLength ||
      image.renderFingerprint !== data.renderFingerprint) {
      issues.push(`${change.id} ${side} image metadata가 snapshot과 다릅니다.`);
    }
    if (!CHANGE_SET_FINGERPRINT_PATTERNS.sha256.test(data.sourceHash)) {
      issues.push(`${change.id} ${side} image sourceHash 형식이 잘못되었습니다.`);
    }
  }
}

function validateTableData(
  change: ChangeSetChange,
  originalSnapshot: DocumentSnapshot | undefined,
  modifiedSnapshot: DocumentSnapshot | undefined,
  issues: string[],
) {
  if (!("tableDetail" in change.data)) {
    issues.push(`${change.id} table data가 없습니다.`);
    return;
  }
  for (const [side, snapshot, changeSide, tableData, cellData] of [
    ["original", originalSnapshot, change.original, change.data.originalTable, change.data.originalCell],
    ["modified", modifiedSnapshot, change.modified, change.data.modifiedTable, change.data.modifiedCell],
  ] as const) {
    if (!changeSide || !snapshot) continue;
    const anchor = changeSide.anchor;
    if (anchor.target !== "table" && anchor.target !== "table-cell") continue;
    const table = snapshot.tables.find((item) =>
      item.sectionIndex === anchor.sectionIndex && item.tableIndex === anchor.tableIndex,
    );
    if (!table || !tableData ||
      table.rowCount !== tableData.rowCount || table.columnCount !== tableData.columnCount ||
      table.structureFingerprint !== tableData.structureFingerprint ||
      table.contentFingerprint !== tableData.contentFingerprint) {
      issues.push(`${change.id} ${side} table metadata가 snapshot과 다릅니다.`);
    }
    if (anchor.target === "table-cell") {
      const cell = table?.cells.find((item) => item.cellIndex === anchor.cellIndex);
      if (!cell || !cellData || cell.cellIndex !== cellData.cellIndex ||
        cell.row !== cellData.row || cell.column !== cellData.column ||
        cell.rowSpan !== cellData.rowSpan || cell.columnSpan !== cellData.columnSpan ||
        cell.text !== cellData.text || cell.fingerprint !== cellData.fingerprint) {
        issues.push(`${change.id} ${side} cell metadata가 snapshot과 다릅니다.`);
      }
    }
  }
}

function validateDocumentFacts(
  payload: ChangeSet,
  side: "original" | "modified",
  snapshot: DocumentSnapshot,
  issues: string[],
) {
  const document = payload.documents[side];
  const outlineCount = snapshot.paragraphs.filter((paragraph) => paragraph.outline).length;
  const sectionIndexes = [
    ...snapshot.paragraphs.map((item) => item.sectionIndex),
    ...snapshot.tables.map((item) => item.sectionIndex),
    ...(snapshot.images ?? []).map((item) => item.sectionIndex),
  ];
  const expected = {
    sectionCount: sectionIndexes.length ? Math.max(...sectionIndexes) + 1 : 0,
    paragraphCount: snapshot.paragraphs.length,
    outlineCount,
    tableCount: snapshot.tables.length,
    imageCount: snapshot.images?.length ?? 0,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (document[key as keyof typeof expected] !== value) issues.push(`${side} document ${key}가 snapshot과 다릅니다.`);
  }
}

interface ExpectedOutlineEntry {
  id: string;
  sectionIndex: number;
  paragraphIndex: number;
  level: number;
  path: OutlinePath;
  scopeStart: number;
  scopeEnd: number;
}

function expectedOutlineEntries(
  side: "original" | "modified",
  snapshot: DocumentSnapshot,
): ExpectedOutlineEntry[] {
  const paragraphs = snapshot.paragraphs
    .filter((paragraph): paragraph is ParagraphSnapshot & { outline: NonNullable<ParagraphSnapshot["outline"]> } => Boolean(paragraph.outline))
    .sort((left, right) => left.sectionIndex - right.sectionIndex || left.paragraphIndex - right.paragraphIndex);
  const stack: ExpectedOutlineEntry[] = [];
  return paragraphs.map((paragraph, index) => {
    while (stack.length && stack.at(-1)!.sectionIndex !== paragraph.sectionIndex) stack.pop();
    while (stack.length && stack.at(-1)!.level >= paragraph.outline.level) stack.pop();
    const segment = {
      level: paragraph.outline.level,
      number: paragraph.outline.number,
      title: paragraph.text,
      displayText: `${paragraph.outline.number} ${paragraph.text}`.trim(),
    };
    const segments = [...stack.map((item) => item.path.segments.at(-1)!), segment];
    const next = paragraphs.slice(index + 1).find((candidate) =>
      candidate.sectionIndex > paragraph.sectionIndex ||
      (candidate.sectionIndex === paragraph.sectionIndex && candidate.outline.level <= paragraph.outline.level),
    );
    const entry: ExpectedOutlineEntry = {
      id: `${side}-outline-${String(index + 1).padStart(6, "0")}`,
      sectionIndex: paragraph.sectionIndex,
      paragraphIndex: paragraph.paragraphIndex,
      level: paragraph.outline.level,
      path: { pathText: segments.map((item) => item.displayText).join(" > "), segments },
      scopeStart: order(paragraph.sectionIndex, paragraph.paragraphIndex),
      scopeEnd: next?.sectionIndex === paragraph.sectionIndex
        ? order(next.sectionIndex, next.paragraphIndex)
        : order(paragraph.sectionIndex + 1, 0),
    };
    stack.push(entry);
    return entry;
  });
}

function validateOutlineCoverage(
  payload: ChangeSet,
  side: "original" | "modified",
  expected: readonly ExpectedOutlineEntry[],
  issues: string[],
) {
  const actual = payload.outlineMappings.flatMap((mapping) => mapping[side]?.outlineId ?? []);
  const expectedIds = expected.map((item) => item.id);
  if (actual.length !== new Set(actual).size) issues.push(`${side} outline coverage가 중복되었습니다.`);
  if (!sameStringSet(actual, expectedIds)) issues.push(`${side} outline coverage가 누락되거나 잘못되었습니다.`);
  if (payload.documents[side].outlineCount !== actual.length) issues.push(`${side} outlineCount와 mapping coverage가 다릅니다.`);
  for (const entry of expected) {
    const mapped = payload.outlineMappings
      .map((mapping) => mapping[side])
      .find((candidate) => candidate?.outlineId === entry.id);
    if (mapped && JSON.stringify(mapped.path) !== JSON.stringify(entry.path)) {
      issues.push(`${side} ${entry.id} 전체 목차 경로가 snapshot과 다릅니다.`);
    }
  }
}

function validateRelatedChangeScopes(
  payload: ChangeSet,
  original: readonly ExpectedOutlineEntry[],
  modified: readonly ExpectedOutlineEntry[],
  issues: string[],
) {
  const changes = new Map(payload.changes.map((change) => [change.id, change]));
  const originalById = new Map(original.map((entry) => [entry.id, entry]));
  const modifiedById = new Map(modified.map((entry) => [entry.id, entry]));
  payload.outlineMappings.forEach((mapping) => {
    const before = mapping.original ? originalById.get(mapping.original.outlineId) : undefined;
    const after = mapping.modified ? modifiedById.get(mapping.modified.outlineId) : undefined;
    mapping.relatedChangeIds.forEach((id) => {
      const change = changes.get(id);
      if (!change) return;
      if (!(
        (before && sideInScope(change.original, before)) ||
        (after && sideInScope(change.modified, after))
      )) issues.push(`${mapping.id}의 ${id}는 해당 목차 scope에 속하지 않습니다.`);
    });
    const expectedIds = payload.changes.filter((change) =>
      (before && sideInScope(change.original, before)) ||
      (after && sideInScope(change.modified, after)),
    ).map((change) => change.id);
    if (!sameStringSet(mapping.relatedChangeIds, expectedIds)) {
      issues.push(`${mapping.id} relatedChangeIds가 해당 목차 scope를 완전히 반영하지 않습니다.`);
    }
  });
}

function sideInScope(side: ChangeSetSide | null, entry: ExpectedOutlineEntry): boolean {
  if (!side) return false;
  const position = order(side.anchor.sectionIndex, side.anchor.paragraphIndex);
  return position >= entry.scopeStart && position < entry.scopeEnd;
}

function pathForAnchor(entries: readonly ExpectedOutlineEntry[], anchor: DocumentAnchor): OutlinePath {
  const position = order(anchor.sectionIndex, anchor.paragraphIndex);
  const entry = [...entries].reverse().find((item) => position >= item.scopeStart && position < item.scopeEnd);
  return entry ? {
    pathText: entry.path.pathText,
    segments: entry.path.segments.map((segment) => ({ ...segment })),
  } : { pathText: "", segments: [] };
}

function validatePath(
  path: OutlinePath,
  side: OutlineMappingSide,
  label: string,
  issues: string[],
) {
  const expectedText = path.segments.map((segment) => segment.displayText).join(" > ");
  if (path.pathText !== expectedText) issues.push(`${label} pathText가 segments와 일치하지 않습니다.`);
  const current = path.segments.at(-1);
  if (!current || current.level !== side.level || current.number !== side.number || current.title !== side.title) {
    issues.push(`${label} 마지막 segment가 현재 목차와 일치하지 않습니다.`);
  }
  for (let index = 1; index < path.segments.length; index += 1) {
    if (path.segments[index].level <= path.segments[index - 1].level) {
      issues.push(`${label} level 경로가 root부터 증가하지 않습니다.`);
      break;
    }
  }
}

function parentPathKey(side: OutlineMappingSide): string {
  return `section:${side.anchor.sectionIndex}|${side.path.segments.slice(0, -1).map((segment) =>
    `${segment.level}:${fingerprintText(normalizeParagraphText(segment.title))}`,
  ).join("/")}`;
}

function findParagraph(snapshot: DocumentSnapshot, sectionIndex: number, paragraphIndex: number) {
  return snapshot.paragraphs.find((paragraph) =>
    paragraph.sectionIndex === sectionIndex && paragraph.paragraphIndex === paragraphIndex,
  );
}

function findCell(snapshot: DocumentSnapshot, anchor: Extract<DocumentAnchor, { target: "table-cell" }>) {
  return snapshot.tables.find((table) =>
    table.sectionIndex === anchor.sectionIndex && table.tableIndex === anchor.tableIndex,
  )?.cells.find((cell) => cell.cellIndex === anchor.cellIndex);
}

function validRange(range: { start: number; end: number }, length?: number): boolean {
  return Number.isInteger(range.start) && Number.isInteger(range.end) &&
    range.start >= 0 && range.end >= range.start && (length === undefined || range.end <= length);
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && new Set(left).size === left.length &&
    left.every((value) => right.includes(value));
}

function order(sectionIndex: number, paragraphIndex: number): number {
  return sectionIndex * 10_000_000 + paragraphIndex;
}
