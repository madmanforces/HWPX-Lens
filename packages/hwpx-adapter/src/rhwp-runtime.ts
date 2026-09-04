import init, { initSync } from "@rhwp/core";
import wasmUrl from "../../../vendor/rhwp-0.8.6-hwpx-lens/rhwp_bg.wasm?url";
import { ensureLocalFontAliasesReady } from "./local-font-aliases";

declare global {
  // Called by rhwp WASM while it performs browser-side text layout.
  // eslint-disable-next-line no-var
  var measureTextWidth: ((font: string, text: string) => number) | undefined;
}

type RhwpInitInput = Parameters<typeof init>[0];

let initialization: Promise<void> | undefined;
let canvasContext: CanvasRenderingContext2D | null | undefined;
let lastFont = "";

export function ensureRhwpInitialized(
  moduleOrPath: RhwpInitInput = { module_or_path: wasmUrl },
): Promise<void> {
  installTextMeasurementBridge();
  if (!initialization) {
    initialization = ensureLocalFontAliasesReady()
      .then(() => init(moduleOrPath))
      .then(() => undefined)
      .catch((error: unknown) => {
        initialization = undefined;
        throw error;
      });
  }
  return initialization;
}

/** Synchronous initializer used by Node contract tests with local WASM bytes. */
export function initializeRhwpForNodeTests(module: Uint8Array): void {
  installTextMeasurementBridge();
  initSync({ module });
  initialization = Promise.resolve();
}

export function installTextMeasurementBridge(): void {
  if (globalThis.measureTextWidth) {
    return;
  }

  globalThis.measureTextWidth = (font, text) => {
    if (canvasContext === undefined) {
      canvasContext =
        typeof document === "undefined"
          ? null
          : document.createElement("canvas").getContext("2d");
    }
    if (!canvasContext) {
      return Array.from(text).length * 7;
    }
    if (font !== lastFont) {
      canvasContext.font = font;
      lastFont = font;
    }
    return canvasContext.measureText(text).width;
  };
}
