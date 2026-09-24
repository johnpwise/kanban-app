import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockRunJob = vi.fn();
const mockJobPath = vi.fn(
  (project: string, location: string, job: string) => `projects/${project}/locations/${location}/jobs/${job}`,
);

vi.mock("@google-cloud/run", () => ({
  JobsClient: vi.fn().mockImplementation(function FakeJobsClient() {
    return { jobPath: mockJobPath, runJob: mockRunJob };
  }),
}));

import { launchAdaCiControllerJob, launchAdaCiControllerJobInEmulator } from "./adaCiControllerJobLauncher";

describe("launchAdaCiControllerJob", () => {
  beforeEach(() => {
    mockRunJob.mockReset();
    mockJobPath.mockClear();
    vi.stubEnv("ADA_GCP_PROJECT_ID", "kanban-app-fa4b7");
    vi.stubEnv("ADA_GCP_REGION", "europe-west2");
    vi.stubEnv("ADA_CI_JOB_NAME", "ada-ci-controller");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requests one execution of the configured CI-controller job overriding only ADA_EXECUTION_RUN_ID", async () => {
    mockRunJob.mockResolvedValue([{ name: "projects/kanban-app-fa4b7/locations/europe-west2/operations/op-1" }]);

    await launchAdaCiControllerJob({ executionRequestId: "req-1" });

    expect(mockJobPath).toHaveBeenCalledWith("kanban-app-fa4b7", "europe-west2", "ada-ci-controller");
    expect(mockRunJob).toHaveBeenCalledTimes(1);
    expect(mockRunJob).toHaveBeenCalledWith({
      name: "projects/kanban-app-fa4b7/locations/europe-west2/jobs/ada-ci-controller",
      overrides: {
        containerOverrides: [{ env: [{ name: "ADA_EXECUTION_RUN_ID", value: "req-1" }] }],
      },
    });
  });

  it("never propagates CODEX_* configuration in the override", async () => {
    vi.stubEnv("ADA_CODEX_MODEL", "gpt-5.6-luna");
    mockRunJob.mockResolvedValue([{ name: "projects/kanban-app-fa4b7/locations/europe-west2/operations/op-1" }]);

    await launchAdaCiControllerJob({ executionRequestId: "req-1" });

    const [[call]] = mockRunJob.mock.calls;
    const env = call.overrides.containerOverrides[0].env as Array<{ name: string }>;
    expect(env.map((entry) => entry.name)).toEqual(["ADA_EXECUTION_RUN_ID"]);
  });

  it("returns the long-running operation's name as the launch result", async () => {
    mockRunJob.mockResolvedValue([{ name: "projects/kanban-app-fa4b7/locations/europe-west2/operations/op-2" }]);

    const result = await launchAdaCiControllerJob({ executionRequestId: "req-2" });

    expect(result).toEqual({ operationName: "projects/kanban-app-fa4b7/locations/europe-west2/operations/op-2" });
  });

  it("propagates a launch failure instead of swallowing it", async () => {
    mockRunJob.mockRejectedValue(Object.assign(new Error("permission denied"), { code: 7 }));

    await expect(launchAdaCiControllerJob({ executionRequestId: "req-3" })).rejects.toThrow("permission denied");
  });
});

describe("launchAdaCiControllerJobInEmulator", () => {
  it("never constructs a real JobsClient or calls runJob", async () => {
    await launchAdaCiControllerJobInEmulator({ executionRequestId: "req-1" });

    expect(mockJobPath).not.toHaveBeenCalled();
    expect(mockRunJob).not.toHaveBeenCalled();
  });

  it("returns a synthetic result so the handler still logs a launch outcome", async () => {
    const result = await launchAdaCiControllerJobInEmulator({ executionRequestId: "req-1" });

    expect(result.operationName).toContain("req-1");
  });
});
