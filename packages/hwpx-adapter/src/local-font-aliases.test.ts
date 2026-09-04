import { describe, expect, it } from "vitest";
import { ensureLocalFontAliasesReady } from "./local-font-aliases";

describe("local HWP font aliases", () => {
  it("registers trusted local-only aliases once", async () => {
    await ensureLocalFontAliasesReady();
    await ensureLocalFontAliasesReady();

    const styles = document.querySelectorAll("#hwpx-lens-local-font-aliases");
    expect(styles).toHaveLength(1);
    expect(styles[0].textContent).toContain('font-family:"한양신명조"');
    expect(styles[0].textContent).toContain('local("HY신명조")');
    expect(styles[0].textContent).toContain('font-family:"한양견고딕"');
    expect(styles[0].textContent).toContain('local("HYGothic-Extra")');
    expect(styles[0].textContent).not.toContain("url(");
  });
});
