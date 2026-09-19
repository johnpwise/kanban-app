import { expect, test } from "@playwright/test";

import { HOME_PAGE_TEST_IDS } from "../src/app/HomePage.testIds";
import { MODE_TOGGLE_TEST_IDS } from "../src/components/mode-toggle/ModeToggle.testIds";

test.describe("app shell", () => {
  test("should navigate from home to about and back", async ({ page }) => {
    // Arrange

    // Act
    await page.goto("/");

    // Assert
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    await expect(page.getByTestId("app-shell")).toBeVisible();

    // Act
    await page.getByRole("link", { name: "About this app" }).click();

    // Assert
    await expect(page).toHaveURL(/\/about$/);
    await expect(page.getByRole("heading", { level: 1, name: "About" })).toBeVisible();
  });

  test("should show the kanban board's card count badge on the home page", async ({ page }) => {
    // Arrange

    // Act
    await page.goto("/");

    // Assert
    await expect(page.getByTestId(HOME_PAGE_TEST_IDS.boardCardCount)).toHaveText(/^\d+ cards?$/);
  });

  test("should submit the subscribe form and show a success message", async ({ page }) => {
    // Arrange
    await page.goto("/about");

    // Act
    await page.getByLabel("Email").fill("person@example.com");
    await page.getByTestId("subscribe-form-submit").click();

    // Assert
    await expect(page.getByTestId("subscribe-form-status")).toHaveText("Subscribed.");
  });

  test("should render dark mode from the server with no hydration errors when the cookie is already set", async ({
    page,
    context,
  }) => {
    // Arrange
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });
    await context.addCookies([
      { name: "isDarkMode", value: "true", url: "http://localhost:3000" },
    ]);

    // Act
    await page.goto("/");

    // Assert
    await expect(page.locator("html")).toHaveClass("dark");
    await expect(page.getByTestId(MODE_TOGGLE_TEST_IDS.label)).toHaveText("Mode is dark");
    expect(consoleErrors).toEqual([]);
  });
});
