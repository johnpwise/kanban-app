import { expect, test } from "@playwright/test";

import { BOARD_PAGE_TEST_IDS } from "../src/app/board/BoardPage.testIds";
import { ADD_CARD_FORM_TEST_IDS } from "../src/components/add-card-form/AddCardForm.testIds";
import { KANBAN_CARD_TEST_IDS } from "../src/components/kanban-card/KanbanCard.testIds";
import { KANBAN_COLUMN_TEST_IDS } from "../src/components/kanban-column/KanbanColumn.testIds";

test.describe("kanban board", () => {
  test.describe.configure({ mode: "serial" });

  test("should move a card to another column using its move control", async ({ page }) => {
    // Arrange
    await page.goto("/board");
    const doneCards = page.getByTestId(KANBAN_COLUMN_TEST_IDS.cardList("done"));
    await expect(page.getByTestId(KANBAN_CARD_TEST_IDS.card("card-1"))).toBeVisible();

    // Act
    await page.getByTestId(KANBAN_CARD_TEST_IDS.moveSelect("card-1")).selectOption("done");

    // Assert
    await expect(doneCards.getByTestId(KANBAN_CARD_TEST_IDS.card("card-1"))).toBeVisible();
  });

  test("should filter cards by label", async ({ page }) => {
    // Arrange
    await page.goto("/board");

    // Act
    await page.getByLabel("Filter by label").selectOption("bug");

    // Assert
    await expect(page.getByTestId(KANBAN_CARD_TEST_IDS.card("card-2"))).toBeVisible();
    await expect(page.getByTestId(KANBAN_CARD_TEST_IDS.card("card-1"))).toHaveCount(0);
  });

  test("should add a new card to a column using its add-card form", async ({ page }) => {
    // Arrange
    await page.goto("/board");
    const doneCards = page.getByTestId(KANBAN_COLUMN_TEST_IDS.cardList("done"));
    const title = `Celebrate the release ${Date.now()}`;

    // Act
    await page.getByTestId(ADD_CARD_FORM_TEST_IDS.titleInput("done")).fill(title);
    await page.getByTestId(ADD_CARD_FORM_TEST_IDS.labelSelect("done")).selectOption("feature");
    await page.getByTestId(ADD_CARD_FORM_TEST_IDS.submit("done")).click();

    // Assert
    await expect(doneCards.getByText(title)).toBeVisible();
  });

  test("should delete a card from a column using its delete button", async ({ page }) => {
    // Arrange
    await page.goto("/board");
    const doneCards = page.getByTestId(KANBAN_COLUMN_TEST_IDS.cardList("done"));
    const title = `Card to delete ${Date.now()}`;
    await page.getByTestId(ADD_CARD_FORM_TEST_IDS.titleInput("done")).fill(title);
    await page.getByTestId(ADD_CARD_FORM_TEST_IDS.submit("done")).click();
    const newCard = doneCards.locator('[data-id^="kanban-card-"]', { hasText: title });
    await expect(newCard).toBeVisible();

    // Act
    await newCard.getByRole("button", { name: `Delete ${title}` }).click();

    // Assert
    await expect(doneCards.getByText(title)).toHaveCount(0);
  });

  test("should reorder cards within a column using a keyboard-accessible move button", async ({ page }) => {
    // Arrange
    await page.goto("/board");
    const doneCards = page.getByTestId(KANBAN_COLUMN_TEST_IDS.cardList("done"));
    const firstTitle = `Reorder first ${Date.now()}`;
    const secondTitle = `Reorder second ${Date.now()}`;

    await page.getByTestId(ADD_CARD_FORM_TEST_IDS.titleInput("done")).fill(firstTitle);
    await page.getByTestId(ADD_CARD_FORM_TEST_IDS.submit("done")).click();
    await page.getByTestId(ADD_CARD_FORM_TEST_IDS.titleInput("done")).fill(secondTitle);
    await page.getByTestId(ADD_CARD_FORM_TEST_IDS.submit("done")).click();

    const firstCard = doneCards.locator('[data-id^="kanban-card-"]', { hasText: firstTitle });
    await expect(firstCard).toBeVisible();
    const titlesBefore = await doneCards.locator('[data-id^="kanban-card-"] p').allTextContents();
    expect(titlesBefore.indexOf(firstTitle)).toBeLessThan(titlesBefore.indexOf(secondTitle));

    // Act: focus and activate the move-down button via the keyboard only, no mouse click.
    await firstCard.getByRole("button", { name: `Move ${firstTitle} down` }).focus();
    await page.keyboard.press("Enter");

    // Assert
    await expect(async () => {
      const titlesAfter = await doneCards.locator('[data-id^="kanban-card-"] p').allTextContents();
      expect(titlesAfter.indexOf(firstTitle)).toBeGreaterThan(titlesAfter.indexOf(secondTitle));
    }).toPass();
  });

  test("should open the raw API response for the board in a new tab", async ({ page, context }) => {
    // Arrange
    await page.goto("/board");

    // Act
    const [apiPage] = await Promise.all([
      context.waitForEvent("page"),
      page.getByTestId(BOARD_PAGE_TEST_IDS.rawApiLink).click(),
    ]);
    await apiPage.waitForLoadState();

    // Assert
    await expect(apiPage).toHaveURL(/\/api\/board$/);
    await expect(apiPage.locator("body")).toContainText("cardsById");
  });
});
