export type ProductProfileId = string;

export interface ProductProfileTableRule {
  labels: string[];
  itemLabel: string;
}

export interface ProductProfileTableCategory {
  filterLabel: string;
  summaryLabel: string;
  rules: ProductProfileTableRule[];
}

/**
 * Presentation and taxonomy policy only. Rendering, semantic snapshots and
 * diff algorithms remain shared by every product profile.
 */
export interface ProductProfile {
  id: ProductProfileId;
  displayName: string;
  documentNoun: string;
  pairNoun: string;
  scopeDescription: string;
  specialTableCategory?: ProductProfileTableCategory;
}
