import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import KanbanCard from "./KanbanCard";
import { KANBAN_CARD_TEST_IDS } from "./KanbanCard.testIds";

const columns = [
  { id: "todo", title: "To Do", cardIds: [] },
  { id: "done", title: "Done", cardIds: [] },
];

describe("KanbanCard", () => {
  it("should render the card title and its label badge", () => {
    // Arrange
    const card = {
      id: "card-1",
      title: "Ship the demo",
      label: "feature" as const,
      createdAt: "2026-01-05T09:00:00.000Z",
      notes: null,
      dueDate: null,
      prompt: "Ship the demo build.",
      executionStatus: "not_started" as const,
      createdBy: "user-1",
      updatedAt: "2026-01-05T09:00:00.000Z",
    };

    // Act
    render(
      <KanbanCard
        card={card}
        columns={columns}
        currentColumnId="todo"
        onMove={vi.fn()}
        onDelete={vi.fn()}
        onReorder={vi.fn()}
        onOpenCard={vi.fn()}
        canMoveUp={true}
        canMoveDown={true}
      />,
    );

    // Assert
    expect(screen.getByText("Ship the demo")).toBeVisible();
    expect(screen.getByText("feature")).toBeVisible();
  });

  it("should call onMove with the destination column when the move control changes", () => {
    // Arrange
    const card = {
      id: "card-1",
      title: "Ship the demo",
      label: null,
      createdAt: "2026-01-05T09:00:00.000Z",
      notes: null,
      dueDate: null,
      prompt: "Ship the demo build.",
      executionStatus: "not_started" as const,
      createdBy: "user-1",
      updatedAt: "2026-01-05T09:00:00.000Z",
    };
    const onMove = vi.fn();
    render(
      <KanbanCard
        card={card}
        columns={columns}
        currentColumnId="todo"
        onMove={onMove}
        onDelete={vi.fn()}
        onReorder={vi.fn()}
        onOpenCard={vi.fn()}
        canMoveUp={true}
        canMoveDown={true}
      />,
    );
    const moveSelect = screen.getByTestId(KANBAN_CARD_TEST_IDS.moveSelect("card-1"));

    // Act
    fireEvent.change(moveSelect, { target: { value: "done" } });

    // Assert
    expect(onMove).toHaveBeenCalledWith("done");
  });

  it("should call onDelete when the delete button is clicked", () => {
    // Arrange
    const card = {
      id: "card-1",
      title: "Ship the demo",
      label: null,
      createdAt: "2026-01-05T09:00:00.000Z",
      notes: null,
      dueDate: null,
      prompt: "Ship the demo build.",
      executionStatus: "not_started" as const,
      createdBy: "user-1",
      updatedAt: "2026-01-05T09:00:00.000Z",
    };
    const onDelete = vi.fn();
    render(
      <KanbanCard
        card={card}
        columns={columns}
        currentColumnId="todo"
        onMove={vi.fn()}
        onDelete={onDelete}
        onReorder={vi.fn()}
        onOpenCard={vi.fn()}
        canMoveUp={true}
        canMoveDown={true}
      />,
    );

    // Act
    fireEvent.click(screen.getByTestId(KANBAN_CARD_TEST_IDS.deleteButton("card-1")));

    // Assert
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it("should call onReorder with the direction when a move-up or move-down button is clicked", () => {
    // Arrange
    const card = {
      id: "card-1",
      title: "Ship the demo",
      label: null,
      createdAt: "2026-01-05T09:00:00.000Z",
      notes: null,
      dueDate: null,
      prompt: "Ship the demo build.",
      executionStatus: "not_started" as const,
      createdBy: "user-1",
      updatedAt: "2026-01-05T09:00:00.000Z",
    };
    const onReorder = vi.fn();
    render(
      <KanbanCard
        card={card}
        columns={columns}
        currentColumnId="todo"
        onMove={vi.fn()}
        onDelete={vi.fn()}
        onReorder={onReorder}
        onOpenCard={vi.fn()}
        canMoveUp={true}
        canMoveDown={true}
      />,
    );

    // Act
    fireEvent.click(screen.getByTestId(KANBAN_CARD_TEST_IDS.moveUpButton("card-1")));
    fireEvent.click(screen.getByTestId(KANBAN_CARD_TEST_IDS.moveDownButton("card-1")));

    // Assert
    expect(onReorder).toHaveBeenNthCalledWith(1, "up");
    expect(onReorder).toHaveBeenNthCalledWith(2, "down");
  });

  it("should disable the move-up button when canMoveUp is false and the move-down button when canMoveDown is false", () => {
    // Arrange
    const card = {
      id: "card-1",
      title: "Ship the demo",
      label: null,
      createdAt: "2026-01-05T09:00:00.000Z",
      notes: null,
      dueDate: null,
      prompt: "Ship the demo build.",
      executionStatus: "not_started" as const,
      createdBy: "user-1",
      updatedAt: "2026-01-05T09:00:00.000Z",
    };

    // Act
    render(
      <KanbanCard
        card={card}
        columns={columns}
        currentColumnId="todo"
        onMove={vi.fn()}
        onDelete={vi.fn()}
        onReorder={vi.fn()}
        onOpenCard={vi.fn()}
        canMoveUp={false}
        canMoveDown={false}
      />,
    );

    // Assert
    expect(screen.getByTestId(KANBAN_CARD_TEST_IDS.moveUpButton("card-1"))).toBeDisabled();
    expect(screen.getByTestId(KANBAN_CARD_TEST_IDS.moveDownButton("card-1"))).toBeDisabled();
  });

  it("should call onOpenCard when the card is double-clicked", () => {
    // Arrange
    const card = {
      id: "card-1",
      title: "Ship the demo",
      label: null,
      createdAt: "2026-01-05T09:00:00.000Z",
      notes: null,
      dueDate: null,
      prompt: "Ship the demo build.",
      executionStatus: "not_started" as const,
      createdBy: "user-1",
      updatedAt: "2026-01-05T09:00:00.000Z",
    };
    const onOpenCard = vi.fn();
    render(
      <KanbanCard
        card={card}
        columns={columns}
        currentColumnId="todo"
        onMove={vi.fn()}
        onDelete={vi.fn()}
        onReorder={vi.fn()}
        onOpenCard={onOpenCard}
        canMoveUp={true}
        canMoveDown={true}
      />,
    );

    // Act
    fireEvent.doubleClick(screen.getByTestId(KANBAN_CARD_TEST_IDS.card("card-1")));

    // Assert
    expect(onOpenCard).toHaveBeenCalledOnce();
  });

  it("should call onOpenCard when Enter is pressed on the focused card", () => {
    // Arrange
    const card = {
      id: "card-1",
      title: "Ship the demo",
      label: null,
      createdAt: "2026-01-05T09:00:00.000Z",
      notes: null,
      dueDate: null,
      prompt: "Ship the demo build.",
      executionStatus: "not_started" as const,
      createdBy: "user-1",
      updatedAt: "2026-01-05T09:00:00.000Z",
    };
    const onOpenCard = vi.fn();
    render(
      <KanbanCard
        card={card}
        columns={columns}
        currentColumnId="todo"
        onMove={vi.fn()}
        onDelete={vi.fn()}
        onReorder={vi.fn()}
        onOpenCard={onOpenCard}
        canMoveUp={true}
        canMoveDown={true}
      />,
    );

    // Act
    fireEvent.keyDown(screen.getByTestId(KANBAN_CARD_TEST_IDS.card("card-1")), { key: "Enter" });

    // Assert
    expect(onOpenCard).toHaveBeenCalledOnce();
  });

  describe("due date rendering (regression: hydration text mismatch, PR follow-up)", () => {
    let originalTz: string | undefined;

    beforeEach(() => {
      originalTz = process.env.TZ;
      // A timezone behind UTC: a UTC-midnight instant for a date-only string
      // falls on the *previous* local calendar day here, which is exactly the
      // divergence that produced server/client hydration mismatch #418.
      process.env.TZ = "America/Los_Angeles";
    });

    afterEach(() => {
      process.env.TZ = originalTz;
    });

    it("should render the due-date badge using the stored calendar day, not a timezone-shifted day", () => {
      // Arrange
      const card = {
        id: "card-1",
        title: "Ship the demo",
        label: null,
        createdAt: "2026-01-05T09:00:00.000Z",
        notes: null,
        dueDate: "2026-09-23",
        prompt: "Ship the demo build.",
        executionStatus: "not_started" as const,
        createdBy: "user-1",
        updatedAt: "2026-01-05T09:00:00.000Z",
      };

      // Act
      render(
        <KanbanCard
          card={card}
          columns={columns}
          currentColumnId="todo"
          onMove={vi.fn()}
          onDelete={vi.fn()}
          onReorder={vi.fn()}
          onOpenCard={vi.fn()}
          canMoveUp={true}
          canMoveDown={true}
        />,
      );

      // Assert
      expect(screen.getByText("9/23/2026")).toBeVisible();
    });
  });
});
