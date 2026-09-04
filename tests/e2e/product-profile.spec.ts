import { expect, test } from "@playwright/test";

const expectedId = process.env.E2E_EXPECTED_PROFILE_ID || "general";
const expectedName = process.env.E2E_EXPECTED_PROFILE_NAME || "일반 문서";
const expectedExtraTableFilter = process.env.E2E_EXPECT_TABLE_FILTER;

test(`renders the fixed ${expectedId} product profile`, async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".lens-app")).toHaveAttribute("data-product-profile", expectedId);
  await expect(page.locator(".product-profile-badge")).toHaveText(expectedName);
  if (expectedExtraTableFilter) {
    await expect(page.getByRole("button", { name: new RegExp(`^${expectedExtraTableFilter}`) }))
      .toBeVisible();
  }
});
