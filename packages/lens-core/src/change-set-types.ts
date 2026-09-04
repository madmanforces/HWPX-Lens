import type { DocumentAnchor, MappingConfidence, TextRange } from "./types";

export const CHANGE_SET_SCHEMA_VERSION = "1.0.0" as const;

export type ChangeSetAnalysisStatus = "complete" | "partial" | "failed";
export type ChangeSetType = "text" | "outline" | "table" | "image";
export type ChangeSetKind = "added" | "removed" | "modified";
export type OutlineRelation =
  | "unchanged"
  | "moved"
  | "renamed"
  | "modified"
  | "added"
  | "removed";

export interface ChangeSetGenerator {
  name: "HWPX Lens";
  version: string;
  lensCoreVersion: string;
  adapterName: string;
  adapterVersion: string;
  analysisIdentity: string;
  productProfile: string;
}

export interface ChangeSetAnalysis {
  status: ChangeSetAnalysisStatus;
  supportedTypes: ChangeSetType[];
  completedTypes: ChangeSetType[];
  warnings: string[];
}

export interface ChangeSetCoordinateSystem {
  name: "lens-semantic-snapshot";
  coordinateBase: 0;
  sectionIndexBase: 0;
  paragraphIndexBase: 0;
  tableIndexBase: 0;
  controlIndexBase: 0;
  cellIndexBase: 0;
  rowIndexBase: 0;
  columnIndexBase: 0;
  pageIndexBase: 0;
  textOffsetUnit: "utf16-code-unit";
  textRangeStart: "inclusive";
  textRangeEnd: "exclusive";
  notes: string[];
}

export interface ChangeSetFingerprintSpec {
  document: {
    algorithm: "sha256";
    input: "raw-file-bytes";
    hexCase: "lowercase";
    version: "document-sha256-v1";
  };
  text: {
    algorithm: "fnv1a-32-js-utf16";
    normalization: string;
    normalizationVersion: "lens-text-v1";
    hexCase: "lowercase";
  };
  table: {
    algorithm: "fnv1a-32-js-utf16";
    normalizationVersion: "lens-table-v1";
  };
  imageSource: {
    algorithm: "sha256";
    input: "original-encoded-resource-bytes";
    hexCase: "lowercase";
    version: "image-source-v1";
  };
  imageRendering: {
    algorithm: "lens-render-fingerprint";
    version: "lens-image-render-v1";
  };
}

export interface ChangeSetDocument {
  documentId: "doc-original" | "doc-modified";
  role: "previous" | "latest";
  fileName: string;
  byteLength: number;
  sha256: string;
  mimeType: "application/hwp+zip";
  sectionCount: number;
  paragraphCount: number;
  outlineCount: number;
  tableCount: number;
  imageCount: number;
}

export interface ChangeSetDocuments {
  original: ChangeSetDocument & { documentId: "doc-original"; role: "previous" };
  modified: ChangeSetDocument & { documentId: "doc-modified"; role: "latest" };
}

export interface ChangeSetSummary {
  totalChanges: number;
  byKind: Record<ChangeSetKind, number>;
  byType: Record<ChangeSetType, number>;
  outlineMappingCount: number;
  outlineRelations: Record<OutlineRelation, number>;
}

export interface OutlinePathSegment {
  level: number;
  number: string;
  title: string;
  displayText: string;
}

export interface OutlinePath {
  pathText: string;
  segments: OutlinePathSegment[];
}

export interface ContentFingerprint {
  spec: "lens-text-v1";
  value: string;
}

export interface ChangeSetSide {
  text?: string;
  normalizedText?: string;
  contentFingerprint?: ContentFingerprint;
  anchor: DocumentAnchor;
  outlinePath: OutlinePath;
}

export interface ChangeSetSegment {
  kind: "equal" | "added" | "removed" | "modified";
  originalRange: TextRange | null;
  modifiedRange: TextRange | null;
  originalBoundary?: number;
  modifiedBoundary?: number;
  whitespace?: "inserted" | "removed";
}

export interface ChangeSetTextData {
  segments: ChangeSetSegment[];
}

export interface ChangeSetOutlineData {
  level: number;
  outlineRelation: "renamed" | "outline-added" | "outline-removed" | "outline-moved";
}

export interface ChangeSetTableSummary {
  rowCount: number;
  columnCount: number;
  structureFingerprint: string;
  contentFingerprint: string;
}

export interface ChangeSetCellSummary {
  cellIndex: number;
  row: number;
  column: number;
  rowSpan: number;
  columnSpan: number;
  text: string;
  fingerprint: string;
}

export interface ChangeSetTableData {
  tableDetail: "cell-text" | "structure" | "table-added" | "table-removed";
  originalTable: ChangeSetTableSummary | null;
  modifiedTable: ChangeSetTableSummary | null;
  originalCell: ChangeSetCellSummary | null;
  modifiedCell: ChangeSetCellSummary | null;
}

export interface ChangeSetImageSummary {
  mimeType: string;
  byteLength: number;
  sourceHash: string;
  renderFingerprint: string;
}

export interface ChangeSetImageData {
  binaryChanged: boolean;
  renderingChanged: boolean;
  classification: "captioned" | "other";
  captionLabel?: string;
  originalImage: ChangeSetImageSummary | null;
  modifiedImage: ChangeSetImageSummary | null;
}

export type ChangeSetData =
  | ChangeSetTextData
  | ChangeSetOutlineData
  | ChangeSetTableData
  | ChangeSetImageData;

export interface ChangeSetChange {
  id: string;
  type: ChangeSetType;
  kind: ChangeSetKind;
  detail: string;
  locationLabel: string;
  mappingConfidence: MappingConfidence;
  original: ChangeSetSide | null;
  modified: ChangeSetSide | null;
  originalContextAnchor: DocumentAnchor | null;
  modifiedContextAnchor: DocumentAnchor | null;
  data: ChangeSetData;
}

export interface OutlineMappingSide {
  outlineId: string;
  level: number;
  number: string;
  title: string;
  displayText: string;
  titleFingerprint: string;
  contentFingerprint: string;
  anchor: DocumentAnchor;
  path: OutlinePath;
}

export interface ChangeSetOutlineMapping {
  id: string;
  relations: OutlineRelation[];
  mappingConfidence: MappingConfidence;
  similarity?: number;
  matchEvidence: string[];
  relatedChangeIds: string[];
  original: OutlineMappingSide | null;
  modified: OutlineMappingSide | null;
}

export interface ChangeSet {
  schemaVersion: typeof CHANGE_SET_SCHEMA_VERSION;
  comparisonId: string;
  exportId: string;
  exportedAt: string;
  generator: ChangeSetGenerator;
  analysis: ChangeSetAnalysis;
  coordinateSystem: ChangeSetCoordinateSystem;
  fingerprintSpec: ChangeSetFingerprintSpec;
  documents: ChangeSetDocuments;
  summary: ChangeSetSummary;
  changes: ChangeSetChange[];
  outlineMappings: ChangeSetOutlineMapping[];
}
