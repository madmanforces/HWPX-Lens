import { expect, test } from "@playwright/test";
import { loadBodyTextFixture } from "../helpers/hwpx-fixture";

test("compares two local HWPX files, navigates changes, and stays offline", async ({ page }) => {
  const externalRequests: string[] = [];
  const pageErrors: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if ((url.protocol === "http:" || url.protocol === "https:") && url.host !== "127.0.0.1:1420") {
      externalRequests.push(request.url());
    }
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "HWPX Lens" })).toBeVisible();
  await expect(page.getByText("OFFLINE", { exact: true })).toBeVisible();

  const original = await loadBodyTextFixture();
  await page.locator('input[type="file"]').nth(0).setInputFiles({
    name: "original.hwpx",
    mimeType: "application/zip",
    buffer: Buffer.from(original),
  });

  const modifiedBase64 = Buffer.from(await loadBodyTextFixture("modified")).toString("base64");
  await page.locator(".file-drop").nth(1).evaluate(
    (dropZone, payload) => {
      const binary = atob(payload.base64);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], payload.name, { type: "application/zip" }));
      dropZone.dispatchEvent(
        new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }),
      );
    },
    { base64: modifiedBase64, name: "modified.hwpx" },
  );

  await expect(page.locator(".change-card")).toHaveCount(2, { timeout: 20_000 });
  await expect(page.locator(".change-nav")).toContainText("1 / 2");
  await expect(page.locator(".document-viewer .review-ink-overlay")).toHaveCount(2, {
    timeout: 20_000,
  });
  await expect(page.locator(".review-ink.is-active rect")).toHaveCount(1);
  await expect(page.locator(".highlight-overlay")).toHaveCount(0);

  await page.getByRole("button", { name: "다음 변경" }).click();
  await expect(page.locator(".change-nav")).toContainText("2 / 2");
  await expect(page.locator(".change-card").nth(1)).toHaveAttribute("aria-selected", "true");

  await expect(page.getByRole("button", { name: "표", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "표", exact: true }).click();
  await expect(page.getByText("선택한 유형의 변경 없음", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "전체", exact: true }).click();
  await expect(page.locator(".change-card")).toHaveCount(2);

  await expect(page.getByRole("button", { name: /^캡션 이미지/ })).toBeEnabled();
  await expect(page.getByRole("button", { name: /^기타 이미지/ })).toBeEnabled();
  await expect(page.getByRole("button", { name: "스타일", exact: true })).toBeDisabled();
  expect(externalRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});
