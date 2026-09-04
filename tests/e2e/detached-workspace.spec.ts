import { expect, test } from "@playwright/test";

test("detaches and restores the shared Review Workspace without reopening documents", async ({ page }) => {
  await page.goto("/");
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "분리", exact: true }).click();
  const popup = await popupPromise;
  await expect(page.getByText("Review Workspace가 분리되어 있습니다.")).toBeVisible();
  await expect(popup.getByRole("complementary", { name: "검토 작업공간" })).toBeVisible();
  await popup.getByRole("button", { name: "목차 구조", exact: true }).click();
  await expect(popup.getByRole("tree", { name: "병합된 문서 목차" })).toBeVisible();
  await popup.getByRole("button", { name: "본창으로", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "검토 작업공간" })).toBeVisible();
  await expect(page.getByText("Review Workspace가 분리되어 있습니다.")).toHaveCount(0);
});
