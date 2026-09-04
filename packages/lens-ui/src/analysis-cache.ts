import { EphemeralLruCache } from "@hwpx-lens/lens-core";
import type {
  Change,
  DocumentComplexityProfile,
  DocumentSnapshot,
  ReviewInkGeometry,
  VisualTarget,
} from "@hwpx-lens/lens-core";

export interface CachedDocumentAnalysis {
  snapshot: DocumentSnapshot;
  complexity: DocumentComplexityProfile;
}

export interface CachedLocatedTarget {
  target?: VisualTarget;
  contextual: boolean;
}

export interface CachedChangeTargets {
  original: CachedLocatedTarget;
  modified: CachedLocatedTarget;
}

export interface CachedPairAnalysis {
  changes: Change[];
  targets: Map<string, CachedChangeTargets>;
  reviewInk: {
    original: ReviewInkGeometry[];
    modified: ReviewInkGeometry[];
  };
  diffMs: number;
  mappingMs: number;
}

/** Sensitive snapshots live in memory only and are released with the LensApp session. */
export class SessionAnalysisCache {
  private readonly documents = new EphemeralLruCache<CachedDocumentAnalysis>(4);
  private readonly pairs = new EphemeralLruCache<CachedPairAnalysis>(4);

  getDocument(key: string): CachedDocumentAnalysis | undefined {
    return this.documents.get(key);
  }

  setDocument(key: string, value: CachedDocumentAnalysis): void {
    this.documents.set(key, value);
  }

  getPair(key: string): CachedPairAnalysis | undefined {
    return this.pairs.get(key);
  }

  setPair(key: string, value: CachedPairAnalysis): void {
    this.pairs.set(key, value);
  }

  clear(): void {
    this.documents.clear();
    this.pairs.clear();
  }

  stats(): { documents: number; pairs: number; persistent: false } {
    return { documents: this.documents.size, pairs: this.pairs.size, persistent: false };
  }
}
