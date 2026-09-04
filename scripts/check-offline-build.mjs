import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const dist = path.resolve("apps/desktop/dist");
await stat(dist).catch(() => {
  throw new Error("Build output is missing. Run npm run build first.");
});

const violations = [];
for (const file of await walk(dist)) {
  if (!/\.(?:html|js|css)$/.test(file)) continue;
  const contents = await readFile(file, "utf8");
  const checks = [
    /<(?:script|link|img|iframe)[^>]+(?:src|href)=["']https?:\/\//gi,
    /\b(?:fetch|WebSocket|EventSource)\s*\(\s*["']https?:\/\//g,
    /@import\s+(?:url\()?\s*["']?https?:\/\//gi,
  ];
  for (const check of checks) {
    if (check.test(contents)) {
      violations.push(path.relative(process.cwd(), file));
      break;
    }
  }
}

const wasm = (await walk(dist)).filter((file) => file.endsWith(".wasm"));
if (wasm.length !== 1) {
  violations.push(`expected exactly one bundled WASM asset; found ${wasm.length}`);
}

if (violations.length) {
  console.error(`Offline build audit failed:\n${violations.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log("Offline build audit passed: local assets only and one bundled rhwp WASM binary.");
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
