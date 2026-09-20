import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createProjectAction } from "@/actions/createProject";

import ProjectDashboard from "./ProjectDashboard";
import { PROJECT_DASHBOARD_TEST_IDS } from "./ProjectDashboard.testIds";

vi.mock("@/actions/createProject", () => ({ createProjectAction: vi.fn() }));

const createProjectActionMock = vi.mocked(createProjectAction);

describe("ProjectDashboard", () => {
  beforeEach(() => {
    createProjectActionMock.mockReset();
  });

  it("should show an empty state and accessible create-project form", () => {
    render(<ProjectDashboard projects={[]} />);

    expect(screen.getByText("No projects yet")).toBeInTheDocument();
    expect(screen.getByLabelText("Project name")).toHaveAttribute("name", "name");
    expect(screen.getByLabelText("GitHub repository")).toHaveAttribute("name", "repository");
    expect(screen.getByLabelText("Default branch")).toHaveAttribute("name", "defaultBranch");
    expect(screen.getByRole("button", { name: "Create project" })).toBeEnabled();
  });

  it("should list projects as links to their independent boards, with their GitHub target", () => {
    render(
      <ProjectDashboard
        projects={[
          {
            id: "project-one",
            name: "Project One",
            repository: "johnpwise/kanban-app",
            defaultBranch: "develop",
            createdAt: "2026-09-19T09:30:00.000Z",
          },
          {
            id: "project-two",
            name: "Project Two",
            repository: "johnpwise/other-repo",
            defaultBranch: "main",
            createdAt: "2026-09-19T10:30:00.000Z",
          },
        ]}
      />,
    );

    expect(screen.getByRole("link", { name: /Project One/ })).toHaveAttribute("href", "/projects/project-one");
    expect(screen.getByRole("link", { name: /Project Two/ })).toHaveAttribute("href", "/projects/project-two");
    expect(screen.getByTestId(PROJECT_DASHBOARD_TEST_IDS.target("project-one"))).toHaveTextContent(
      "johnpwise/kanban-app · develop",
    );
    expect(screen.getByTestId(PROJECT_DASHBOARD_TEST_IDS.target("project-two"))).toHaveTextContent(
      "johnpwise/other-repo · main",
    );
  });

  it("should show a safe action error", async () => {
    createProjectActionMock.mockResolvedValue({ status: "error", message: "Could not create the project." });
    render(<ProjectDashboard projects={[]} />);

    fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "Launch plan" } });
    fireEvent.change(screen.getByLabelText("GitHub repository"), { target: { value: "johnpwise/kanban-app" } });
    fireEvent.change(screen.getByLabelText("Default branch"), { target: { value: "develop" } });
    fireEvent.submit(screen.getByTestId(PROJECT_DASHBOARD_TEST_IDS.form));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Could not create the project.");
    expect(screen.getByLabelText("Project name")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Project name")).toHaveAttribute("aria-describedby", status.id);
  });

  it("should disable submission and announce pending project creation", async () => {
    let resolveAction: ((value: { status: "error"; message: string }) => void) | undefined;
    createProjectActionMock.mockImplementation(
      () => new Promise((resolve) => {
        resolveAction = resolve;
      }),
    );
    render(<ProjectDashboard projects={[]} />);

    fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "Launch plan" } });
    fireEvent.submit(screen.getByTestId(PROJECT_DASHBOARD_TEST_IDS.form));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Creating project…" })).toBeDisabled();
    });

    resolveAction?.({ status: "error", message: "Try again." });
  });
});
