import { test as setup, expect } from "@playwright/test";

const authFile = "playwright/.auth/user.json";

// E2E_USERNAME is a local test user with the "owner" role (created via POST /api/auth/signup).
setup("sign in once and save the session", async ({ page }) => {
  const username = process.env.E2E_USERNAME;
  const password = process.env.E2E_PASSWORD;
  if (!username || !password) {
    throw new Error("Set E2E_USERNAME and E2E_PASSWORD (see context/foundation/test-stack.md, ## E2E)");
  }

  await page.goto("/auth/signin");
  // SignInForm is a React island: input typed before it hydrates is dropped and its validation
  // then blocks the submit. Retry fill + submit until the submit leaves the sign-in page.
  // Clear before filling: re-filling the same value fires no change event in a controlled input.
  await expect(async () => {
    await page.getByRole("textbox", { name: "E-mail" }).fill("");
    await page.getByRole("textbox", { name: "E-mail" }).fill(username);
    await page.getByRole("textbox", { name: "Hasło" }).fill("");
    await page.getByRole("textbox", { name: "Hasło" }).fill(password);
    await page.getByRole("button", { name: "Zaloguj się" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/auth/signin"), { timeout: 5_000 });
  }).toPass();
  await expect(page.getByRole("heading", { name: "Panel właściciela", level: 1 })).toBeVisible();

  await page.context().storageState({ path: authFile });
});
