import { expect, test } from "@playwright/test";

import { ADD_CARD_FORM_TEST_IDS } from "../src/components/add-card-form/AddCardForm.testIds";
import { CARD_DETAIL_MODAL_TEST_IDS } from "../src/components/card-detail-modal/CardDetailModal.testIds";
import { KANBAN_COLUMN_TEST_IDS } from "../src/components/kanban-column/KanbanColumn.testIds";
import { PROJECT_BOARD_PAGE_TEST_IDS } from "../src/app/projects/[projectId]/ProjectBoardPage.testIds";

import type { Page } from "@playwright/test";

async function createProject(page: Page, name: string) {
  await page.goto("/");
  await page.getByLabel("Project name").fill(name);
  await page.getByLabel("GitHub repository").fill("johnpwise/kanban-app");
  await page.getByLabel("Default branch").fill("develop");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  return page.url().split("/").at(-1) as string;
}

async function addCard(page: Page, columnId: string, title: string, label?: "bug" | "feature" | "chore") {
  await page.getByTestId(ADD_CARD_FORM_TEST_IDS.titleInput(columnId)).fill(title);
  if (label) {
    await page.getByTestId(ADD_CARD_FORM_TEST_IDS.labelSelect(columnId)).selectOption(label);
  }
  await page.getByTestId(ADD_CARD_FORM_TEST_IDS.promptInput(columnId)).fill(`Prompt for ${title}`);
  await page.getByTestId(ADD_CARD_FORM_TEST_IDS.submit(columnId)).click();
  await expect(page.getByTestId(KANBAN_COLUMN_TEST_IDS.cardList(columnId)).getByText(title)).toBeVisible();
}

test.describe("project boards", () => {
  test("should create a project with three empty columns", async ({ page }) => {
    const name = `Project ${Date.now()}`;

    await createProject(page, name);

    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: /To Do/ })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: /In Progress/ })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: /Done/ })).toBeVisible();
  });

  test("should keep cards isolated between two projects", async ({ page }) => {
    const firstTitle = `Only first ${Date.now()}`;
    const firstProjectId = await createProject(page, `First ${Date.now()}`);
    await addCard(page, "todo", firstTitle, "feature");

    const secondProjectId = await createProject(page, `Second ${Date.now()}`);
    await expect(page.getByText(firstTitle)).toHaveCount(0);

    await page.goto(`/projects/${firstProjectId}`);
    await expect(page.getByText(firstTitle)).toBeVisible();
    expect(secondProjectId).not.toBe(firstProjectId);
  });

  test("should move, reorder, update, and delete cards", async ({ page }) => {
    await createProject(page, `Mutations ${Date.now()}`);
    const firstTitle = `First ${Date.now()}`;
    const secondTitle = `Second ${Date.now()}`;
    await addCard(page, "todo", firstTitle);
    await addCard(page, "todo", secondTitle);

    const firstCard = page.locator('[data-id^="kanban-card-"]', { hasText: firstTitle });
    await firstCard.getByRole("button", { name: `Move ${firstTitle} down` }).click();
    const titles = await page
      .getByTestId(KANBAN_COLUMN_TEST_IDS.cardList("todo"))
      .locator('[data-id^="kanban-card-"] p')
      .allTextContents();
    expect(titles.indexOf(firstTitle)).toBeGreaterThan(titles.indexOf(secondTitle));

    await firstCard.getByRole("combobox", { name: "Move to" }).selectOption("done");
    await expect(page.getByTestId(KANBAN_COLUMN_TEST_IDS.cardList("done")).getByText(firstTitle)).toBeVisible();

    await firstCard.dblclick();
    await page.getByTestId(CARD_DETAIL_MODAL_TEST_IDS.notesInput).fill("Ready for review");
    await page.getByTestId(CARD_DETAIL_MODAL_TEST_IDS.dueDateInput).fill("2026-10-01");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await firstCard.dblclick();
    await expect(page.getByTestId(CARD_DETAIL_MODAL_TEST_IDS.notesInput)).toHaveValue("Ready for review");
    await page.getByRole("button", { name: "Close", exact: true }).click();

    await firstCard.getByRole("button", { name: `Delete ${firstTitle}` }).click();
    await expect(page.getByText(firstTitle)).toHaveCount(0);
  });

  test("should keep label filtering local to each project", async ({ page }) => {
    await createProject(page, `Filtered ${Date.now()}`);
    await addCard(page, "todo", `Feature ${Date.now()}`, "feature");
    await page.getByLabel("Filter by label").selectOption("bug");

    await createProject(page, `Fresh ${Date.now()}`);

    await expect(page.getByLabel("Filter by label")).toHaveValue("all");
  });

  test("should expose the project-scoped raw board API", async ({ page, context }) => {
    const projectId = await createProject(page, `API ${Date.now()}`);

    const [apiPage] = await Promise.all([
      context.waitForEvent("page"),
      page.getByTestId(PROJECT_BOARD_PAGE_TEST_IDS.rawApiLink).click(),
    ]);
    await apiPage.waitForLoadState();

    await expect(apiPage).toHaveURL(new RegExp(`/api/projects/${projectId}/board$`));
    await expect(apiPage.locator("body")).toContainText("cardsById");
  });

  test("should return 404 for a missing project and redirect legacy board navigation", async ({ page }) => {
    const response = await page.goto("/projects/missing-project");
    expect(response?.status()).toBe(404);

    await page.goto("/board");
    await expect(page).toHaveURL(/\/$/);
  });

  test("should start ADA work and show Queued without moving the card to another column", async ({ page }) => {
    await createProject(page, `ADA ${Date.now()}`);
    const title = `Task ${Date.now()}`;
    await addCard(page, "todo", title);

    const card = page.locator('[data-id^="kanban-card-"]', { hasText: title });
    await card.dblclick();
    await expect(page.getByTestId(CARD_DETAIL_MODAL_TEST_IDS.executionStatusBadge)).toContainText(
      "Not Started",
    );

    await page.getByTestId(CARD_DETAIL_MODAL_TEST_IDS.startExecutionButton).click();

    await expect(page.getByTestId(CARD_DETAIL_MODAL_TEST_IDS.executionStatusBadge)).toContainText("Queued");
    await expect(page.getByTestId(CARD_DETAIL_MODAL_TEST_IDS.startExecutionButton)).toHaveCount(0);

    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByTestId(KANBAN_COLUMN_TEST_IDS.cardList("todo")).getByText(title)).toBeVisible();
  });
});
