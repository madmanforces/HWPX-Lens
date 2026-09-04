import { describe, expect, it } from "vitest";
import { readValidatedHwpx } from "./file-validation";

describe("readValidatedHwpx", () => {
  it("accepts a case-insensitive HWPX file with a ZIP signature", async () => {
    const file = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1])], "문서.HWPX");
    await expect(readValidatedHwpx(file)).resolves.toEqual(
      new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1]),
    );
  });

  it("rejects renamed and unsupported files", async () => {
    const renamed = new File([new Uint8Array([1, 2, 3, 4])], "renamed.hwpx");
    const hwp = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], "legacy.hwp");
    await expect(readValidatedHwpx(renamed)).rejects.toThrow(/ZIP 시그니처/);
    await expect(readValidatedHwpx(hwp)).rejects.toThrow(/\.hwpx/);
  });
});
