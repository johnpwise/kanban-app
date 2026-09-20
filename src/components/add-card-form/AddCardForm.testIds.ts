export const ADD_CARD_FORM_TEST_IDS = {
  form: (columnId: string) => `add-card-form-${columnId}`,
  titleInput: (columnId: string) => `add-card-title-${columnId}`,
  labelSelect: (columnId: string) => `add-card-label-${columnId}`,
  promptInput: (columnId: string) => `add-card-prompt-${columnId}`,
  submit: (columnId: string) => `add-card-submit-${columnId}`,
} as const;
