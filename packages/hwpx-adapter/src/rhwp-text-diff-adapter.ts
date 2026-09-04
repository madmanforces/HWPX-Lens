import {
  compareDocumentSnapshots,
  type Change,
  type DiffAdapter,
  type DocumentSnapshot,
} from "@hwpx-lens/lens-core";

/**
 * M0 implementation: body paragraph text only. It deliberately does not call
 * rhwp-studio internals or expose table/image/style comparison.
 */
export class RhwpTextDiffAdapter implements DiffAdapter {
  readonly analysisIdentity = "lens-body-outline-diff-v5-outline-alignment";
  readonly supportedTypes = ["text", "outline"] as const;

  async compare(original: DocumentSnapshot, modified: DocumentSnapshot): Promise<Change[]> {
    return compareDocumentSnapshots(original, modified, this.supportedTypes);
  }
}
