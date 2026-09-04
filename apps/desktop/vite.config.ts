import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface BuildProfile {
  id: string;
  displayName: string;
  documentNoun: string;
  pairNoun: string;
  scopeDescription: string;
  specialTableCategory?: {
    filterLabel: string;
    summaryLabel: string;
    rules: Array<{ labels: string[]; itemLabel: string }>;
  };
}

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const profilePath = env.HWPX_LENS_PROFILE_CONFIG?.trim();
  const localProfile = profilePath ? readLocalProfile(profilePath) : undefined;
  const productProfile = localProfile?.id ?? "general";
  return {
    plugins: [
      react(),
      {
        name: "hwpx-lens-product-profile-manifest",
        generateBundle() {
          this.emitFile({
            type: "asset",
            fileName: "product-profile.json",
            source: `${JSON.stringify({
              profile: productProfile,
              distribution: localProfile ? "local" : "public",
            }, null, 2)}\n`,
          });
        },
      },
    ],
    define: {
      "import.meta.env.VITE_HWPX_LENS_PRODUCT_PROFILE": JSON.stringify(productProfile),
      "import.meta.env.VITE_HWPX_LENS_PRODUCT_PROFILE_JSON": JSON.stringify(
        localProfile ? JSON.stringify(localProfile) : "",
      ),
    },
    clearScreen: false,
    server: {
      host: "127.0.0.1",
      port: 1420,
      strictPort: true,
    },
    build: {
      target: "es2022",
      sourcemap: false,
    },
  };
});

function readLocalProfile(profilePath: string): BuildProfile {
  const absolutePath = path.isAbsolute(profilePath)
    ? profilePath
    : path.resolve(repositoryRoot, profilePath);
  const parsed: unknown = JSON.parse(readFileSync(absolutePath, "utf8"));
  if (!isBuildProfile(parsed)) {
    throw new Error(`Invalid local product profile: ${absolutePath}`);
  }
  return parsed;
}

function isBuildProfile(value: unknown): value is BuildProfile {
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
