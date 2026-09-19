export const KANBAN_COLUMN_TEST_IDS = {
  column: (columnId: string) => `kanban-column-${columnId}`,
  cardList: (columnId: string) => `kanban-column-cards-${columnId}`,
} as const;
