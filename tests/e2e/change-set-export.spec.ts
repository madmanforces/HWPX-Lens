import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { loadBodyTextFixture } from "../helpers/hwpx-fixture";

test("exports a validated generic Change Set and handles privacy cancellation", async ({ page }) => {
  await page.goto("/");
  const original = await loadBodyTextFixture();
  const modified = await loadBodyTextFixture("modified");
  await page.locator('input[type="file"]').nth(0).setInputFiles({
    name: "previous.hwpx",
    mimeType: "application/zip",
    buffer: Buffer.from(original),
  });
  await page.locator('input[type="file"]').nth(1).setInputFiles({
    name: "latest.hwpx",
    mimeType: "application/zip",
    buffer: Buffer.from(modified),
  });

  const exportButton = page.getByRole("button", { name: "Change Set JSON 내보내기" });
  await expect(exportButton).toBeEnabled({ timeout: 20_000 });

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("변경 전후 텍스트");
    expect(dialog.message()).toContain("원본 이미지 바이너리는 포함되지 않지만");
    await dialog.dismiss();
  });
  await exportButton.click();
  await expect(page.getByText("내보내기를 취소했습니다.", { exact: true })).toBeVisible();
  await expect(page.locator(".change-card")).toHaveCount(2);

  page.once("dialog", async (dialog) => dialog.accept());
  const downloadPromise = page.waitForEvent("download");
  await exportButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^hwpx-lens-[0-9a-f]{12}-change-set\.json$/u);
  const savedPath = await download.path();
  expect(savedPath).not.toBeNull();
  const bytes = await readFile(savedPath!);
  expect([...bytes.slice(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf]);
  expect(bytes.at(-1)).toBe(0x0a);
  const payload = JSON.parse(bytes.toString("utf8"));
  expect(Object.keys(payload)).toEqual([
    "schemaVersion", "comparisonId", "exportId", "exportedAt", "generator",
    "analysis", "coordinateSystem", "fingerprintSpec", "documents", "summary",
    "changes", "outlineMappings",
  ]);
  expect(payload.schemaVersion).toBe("1.0.0");
  expect(payload.generator.version).toBe("0.1.1");
  expect(payload.generator.lensCoreVersion).toBe("0.0.1");
  expect(payload.generator.adapterVersion).toBe("0.0.1");
  expect(payload.documents.original.role).toBe("previous");
  expect(payload.documents.modified.role).toBe("latest");
  expect(payload.documents.original.sha256).toBe(
    createHash("sha256").update(original).digest("hex"),
  );
  expect(payload.documents.modified.sha256).toBe(
    createHash("sha256").update(modified).digest("hex"),
  );
  expect(payload.summary.totalChanges).toBe(payload.changes.length);
  expect(JSON.stringify(payload)).not.toContain("data:image");
  await expect(page.getByText("Change Set JSON을 저장했습니다.", { exact: true })).toBeVisible();
});
