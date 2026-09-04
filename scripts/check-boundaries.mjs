import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const sourceRoots = [
  "packages/lens-core/src",
  "packages/lens-ui/src",
  "apps/desktop/src",
];
const forbidden = ["@rhwp/core", "rhwp-studio/src", "compare/diff-engine"];
const violations = [];

for (const sourceRoot of sourceRoots) {
  for (const file of await walk(path.join(root, sourceRoot))) {
    if (!/\.(?:ts|tsx|js|jsx)$/.test(file)) continue;
    const contents = await readFile(file, "utf8");
    for (const token of forbidden) {
      if (contents.includes(token)) {
        violations.push(`${path.relative(root, file)} imports or references ${token}`);
      }
    }
  }
}

if (violations.length) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Adapter boundary check passed: rhwp is isolated in packages/hwpx-adapter.");
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(target)));
    else files.push(target);
  }
  return files;
}
