import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { HwpDocument, initSync } from "@rhwp/core";

const outputDirectory = path.resolve("test-results/review-ink-manual");
const wasm = await readFile(path.resolve("vendor/rhwp-0.8.6-hwpx-lens/rhwp_bg.wasm"));
const encoded = (await readFile(
  path.resolve("tests/fixtures/body-text-public.hwpx.base64"),
  "utf8",
)).trim();

globalThis.measureTextWidth = (_font, text) => Array.from(text).length * 7;
initSync({ module: wasm });

const source = new HwpDocument(new Uint8Array(Buffer.from(encoded, "base64")));
let original;
try {
  replaceParagraph(source, 0, "전원을 끈다.");
  replaceParagraph(source, 1, "각 붙여쓰기");
  original = source.exportHwpx();
} finally {
  source.free();
}

const changed = new HwpDocument(original);
let modified;
try {
  replaceParagraph(changed, 0, "전원을 차단한다.");
  replaceParagraph(changed, 1, "각 붙여 쓰기");
  modified = changed.exportHwpx();
} finally {
  changed.free();
}

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(path.join(outputDirectory, "review-ink-original.hwpx"), original),
  writeFile(path.join(outputDirectory, "review-ink-modified.hwpx"), modified),
]);

process.stdout.write(`${outputDirectory}\n`);

function replaceParagraph(document, paragraphIndex, text) {
  const length = document.getParagraphLength(0, paragraphIndex);
  if (length > 0) document.deleteText(0, paragraphIndex, 0, length);
  document.insertText(0, paragraphIndex, 0, text);
}
