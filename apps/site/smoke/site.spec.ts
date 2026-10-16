import { expect, test } from "@playwright/test";

test("page loads, simulator runs, form reaches Calendly", async ({ page }) => {
  await page.goto("/nexus");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("AI decisioning");
  await page.getByRole("button", { name: "4×" }).click();
  await page.getByRole("button", { name: "Run" }).click();
  await expect(page.getByText(/^30 \/ 30$/)).toBeVisible({ timeout: 30_000 });

  await page.getByLabel("Work email").fill("smoke-test@beaconfrontier.com");
  await page.getByLabel("Company").fill("Smoke Test");
  await page.getByLabel("Use case to pilot").fill("Automated smoke test, ignore");
  await page.getByRole("button", { name: /become a design partner/i }).click();
  await expect(page.getByTitle("Book a call")).toBeVisible({ timeout: 15_000 });
});

test("demo walkthrough deep link shows the Braze Catalog payload", async ({ page }) => {
  await page.goto("/nexus/demo?step=5&source=braze-catalog");
  await expect(page.getByText("catalog_item_id").first()).toBeVisible();
});
