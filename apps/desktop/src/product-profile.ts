import {
  GENERAL_DOCUMENT_PROFILE,
  type ProductProfile,
} from "@hwpx-lens/lens-ui";

const rawProfile = import.meta.env.VITE_HWPX_LENS_PRODUCT_PROFILE_JSON;

export const PRODUCT_PROFILE: ProductProfile = rawProfile
  ? parseProductProfile(rawProfile)
  : GENERAL_DOCUMENT_PROFILE;
export const PRODUCT_PROFILE_ID = PRODUCT_PROFILE.id;

function parseProductProfile(value: string): ProductProfile {
  const parsed: unknown = JSON.parse(value);
  if (!isProductProfile(parsed)) {
    throw new Error("Invalid local HWPX Lens product profile configuration.");
  }
  return Object.freeze(parsed);
}

function isProductProfile(value: unknown): value is ProductProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Record<string, unknown>;
  return typeof profile.id === "string"
    && /^[a-z0-9-]+$/.test(profile.id)
    && typeof profile.displayName === "string"
    && typeof profile.documentNoun === "string"
    && typeof profile.pairNoun === "string"
    && typeof profile.scopeDescription === "string"
    && isTableCategory(profile.specialTableCategory);
}

function isTableCategory(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== "object") return false;
  const category = value as Record<string, unknown>;
  return typeof category.filterLabel === "string"
    && typeof category.summaryLabel === "string"
    && Array.isArray(category.rules)
    && category.rules.every((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const rule = entry as Record<string, unknown>;
      return Array.isArray(rule.labels)
        && rule.labels.every((label) => typeof label === "string")
        && typeof rule.itemLabel === "string";
    });
}
