import { test, expect } from "@playwright/test";

// Risk #2 (context/foundation/test-plan.md): a signed-in owner must not reach the agent panel.
// The middleware role gate sends a user on another role's prefix back to their own panel.
// Signed in as the owner from auth.setup.ts; creates no data, so there is nothing to clean up.
test("signed-in owner opening an agent page is sent back to the owner panel", async ({ page }) => {
  await page.goto("/agent/profile");

  await page.waitForURL("/owner");
  await expect(page.getByRole("heading", { name: "Panel właściciela", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Nowa oferta" })).toBeVisible();
});
