import { readFile } from "node:fs/promises";
import path from "node:path";

const expected = process.argv[2];
const expectedDistribution = process.argv[3];
if (!expected || !/^[a-z0-9-]+$/.test(expected)) {
  throw new Error("Usage: node scripts/check-product-profile.mjs <profile-id> [public|local]");
}
if (expectedDistribution && !["public", "local"].includes(expectedDistribution)) {
  throw new Error("Distribution must be public or local.");
}

const manifestPath = path.resolve("apps/desktop/dist/product-profile.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (manifest.profile !== expected) {
  throw new Error(
    `Product profile mismatch: expected ${expected}, built ${String(manifest.profile)}`,
  );
}
if (expectedDistribution && manifest.distribution !== expectedDistribution) {
  throw new Error(
    `Product distribution mismatch: expected ${expectedDistribution}, built ${String(manifest.distribution)}`,
  );
}

console.log(
  `Product profile check passed: ${expected} (${manifest.distribution ?? "unknown"}).`,
);
