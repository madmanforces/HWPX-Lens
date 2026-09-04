import {
  compareDocumentSnapshots,
  type Change,
  type DiffAdapter,
  type DocumentSnapshot,
} from "@hwpx-lens/lens-core";

/**
 * Public HWPX Lens diff boundary for body text and table semantics.
 * It consumes engine-neutral snapshots and never imports Studio diff internals.
 */
export class RhwpDiffAdapter implements DiffAdapter {
  readonly analysisIdentity = "lens-body-outline-table-image-diff-v6-outline-alignment";
  readonly supportedTypes = ["text", "outline", "table", "image"] as const;

  async compare(original: DocumentSnapshot, modified: DocumentSnapshot): Promise<Change[]> {
    return compareDocumentSnapshots(original, modified, this.supportedTypes);
  }
}
