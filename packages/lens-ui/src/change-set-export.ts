import {
  assertChangeSetIntegrity,
  buildChangeSet,
  createExportId,
  isoDateTimeWithOffset,
  serializeChangeSet,
  type Change,
  type ChangeSet,
  type ChangeType,
  type DocumentSnapshot,
} from "@hwpx-lens/lens-core";
import { readValidatedHwpx } from "./file-validation";

export interface ChangeSetGeneratorInfo {
  version: string;
  lensCoreVersion: string;
  adapterName: string;
  adapterVersion: string;
}

export interface PreparedChangeSetExport {
  payload: ChangeSet;
  json: string;
  defaultFileName: string;
}

export interface SaveChangeSetRequest {
  contents: string;
  defaultFileName: string;
}

export type SaveChangeSetResult = "saved" | "cancelled";
export type SaveChangeSetFile = (
  request: SaveChangeSetRequest,
) => Promise<SaveChangeSetResult>;

export async function prepareChangeSetExport(input: {
  originalFile: File;
  modifiedFile: File;
  originalSnapshot: DocumentSnapshot;
  modifiedSnapshot: DocumentSnapshot;
  changes: readonly Change[];
  supportedTypes: readonly ChangeType[];
  analysisIdentity: string;
  productProfile: string;
  generator: ChangeSetGeneratorInfo;
  exportId?: string;
  exportedAt?: string;
}): Promise<PreparedChangeSetExport> {
  // File objects are immutable browser snapshots. Re-reading them here creates
  // an export-time consistency boundary without retaining a second large byte
  // buffer for the whole review session.
  const [originalBytes, modifiedBytes] = await Promise.all([
    readValidatedHwpx(input.originalFile),
    readValidatedHwpx(input.modifiedFile),
  ]);
  const completedTypes = [...input.supportedTypes];
  const payload = await buildChangeSet({
    original: {
      fileName: input.originalFile.name,
      bytes: originalBytes,
      snapshot: input.originalSnapshot,
    },
    modified: {
      fileName: input.modifiedFile.name,
      bytes: modifiedBytes,
      snapshot: input.modifiedSnapshot,
    },
    changes: input.changes,
    generator: {
      ...input.generator,
      analysisIdentity: input.analysisIdentity,
      productProfile: input.productProfile,
    },
    analysis: {
      status: "complete",
      supportedTypes: [...input.supportedTypes],
      completedTypes,
      warnings: [],
    },
    exportId: input.exportId ?? createExportId(),
    exportedAt: input.exportedAt ?? isoDateTimeWithOffset(),
  });
  await assertChangeSetIntegrity(payload, {
    originalBytes,
    modifiedBytes,
    originalSnapshot: input.originalSnapshot,
    modifiedSnapshot: input.modifiedSnapshot,
    expectedSupportedTypes: input.supportedTypes,
    expectedCompletedTypes: completedTypes,
  });
  return {
    payload,
    json: serializeChangeSet(payload),
    defaultFileName: `hwpx-lens-${payload.comparisonId.slice(4, 16)}-change-set.json`,
  };
}
