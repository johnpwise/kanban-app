export const PROJECT_DASHBOARD_TEST_IDS = {
  form: "project-dashboard-form",
  nameInput: "project-dashboard-name-input",
  repositoryInput: "project-dashboard-repository-input",
  defaultBranchInput: "project-dashboard-default-branch-input",
  submit: "project-dashboard-submit",
  status: "project-dashboard-status",
  list: "project-dashboard-list",
  empty: "project-dashboard-empty",
  target: (projectId: string) => `project-dashboard-target-${projectId}`,
} as const;
