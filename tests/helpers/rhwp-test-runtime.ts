import { readFile } from "node:fs/promises";
import path from "node:path";
import { HwpDocument } from "@rhwp/core";
import { initializeRhwpForNodeTests } from "../../packages/hwpx-adapter/src/rhwp-runtime";
import { loadBodyTextFixture } from "./hwpx-fixture";

let initialized = false;

export async function initializeRhwpTestRuntime(): Promise<void> {
  if (initialized) return;
  globalThis.measureTextWidth = (_font, text) => Array.from(text).length * 7;
  const wasm = await readFile(path.resolve("vendor/rhwp-0.8.6-hwpx-lens/rhwp_bg.wasm"));
  initializeRhwpForNodeTests(wasm);
  initialized = true;
}

export async function createTableFixture(changedCellText: string): Promise<Uint8Array> {
  await initializeRhwpTestRuntime();
  const document = new HwpDocument(await loadBodyTextFixture());
  try {
    const created = JSON.parse(document.createTable(0, 0, 0, 2, 2)) as {
      ok: boolean;
      paraIdx: number;
      controlIdx: number;
    };
    if (!created.ok) throw new Error("합성 표를 만들지 못했습니다.");
    document.insertTextInCell(0, created.paraIdx, created.controlIdx, 0, 0, 0, "항목");
    document.insertTextInCell(
      0,
      created.paraIdx,
      created.controlIdx,
      1,
      0,
      0,
      changedCellText,
    );
    document.insertTextInCell(0, created.paraIdx, created.controlIdx, 2, 0, 0, "공통 값");
    return document.exportHwpx();
  } finally {
    document.free();
  }
}
