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

import { AdaCodexModelConfigError } from "./adaCodexModelPolicy";
import { launchAdaExecutorJob, launchAdaExecutorJobInEmulator } from "./adaExecutorJobLauncher";

describe("launchAdaExecutorJob", () => {
  beforeEach(() => {
    mockRunJob.mockReset();
    mockJobPath.mockClear();
    // `defineString(...).value()` only reads `process.env` at runtime (the `default` is applied by
    // the Firebase CLI into a deploy-time `.env` file, not by `.value()` itself) — stub the env vars
    // a real deployment would have populated, per adaExecutorRunLauncherConfig.ts's defaults.
    vi.stubEnv("ADA_GCP_PROJECT_ID", "kanban-app-fa4b7");
    vi.stubEnv("ADA_GCP_REGION", "europe-west2");
    vi.stubEnv("ADA_JOB_NAME", "ada-executor");
    vi.stubEnv("ADA_CODEX_MODEL", "gpt-5.6-luna");
    vi.stubEnv("ADA_CODEX_REASONING_EFFORT", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requests one execution of the configured job overriding ADA_EXECUTION_RUN_ID and the approved CODEX_MODEL", async () => {
    mockRunJob.mockResolvedValue([{ name: "projects/kanban-app-fa4b7/locations/europe-west2/operations/op-1" }]);

    await launchAdaExecutorJob({ executionRequestId: "req-1" });

    expect(mockJobPath).toHaveBeenCalledWith("kanban-app-fa4b7", "europe-west2", "ada-executor");
    expect(mockRunJob).toHaveBeenCalledTimes(1);
    expect(mockRunJob).toHaveBeenCalledWith({
      name: "projects/kanban-app-fa4b7/locations/europe-west2/jobs/ada-executor",
      overrides: {
        containerOverrides: [
          {
            env: [
              { name: "ADA_EXECUTION_RUN_ID", value: "req-1" },
              { name: "CODEX_MODEL", value: "gpt-5.6-luna" },
            ],
          },
        ],
      },
    });
  });

  it("includes CODEX_REASONING_EFFORT in the override when configured", async () => {
    vi.stubEnv("ADA_CODEX_REASONING_EFFORT", "high");
    mockRunJob.mockResolvedValue([{ name: "projects/kanban-app-fa4b7/locations/europe-west2/operations/op-1" }]);

    await launchAdaExecutorJob({ executionRequestId: "req-1" });

    expect(mockRunJob).toHaveBeenCalledWith({
      name: "projects/kanban-app-fa4b7/locations/europe-west2/jobs/ada-executor",
      overrides: {
        containerOverrides: [
          {
            env: [
              { name: "ADA_EXECUTION_RUN_ID", value: "req-1" },
              { name: "CODEX_MODEL", value: "gpt-5.6-luna" },
              { name: "CODEX_REASONING_EFFORT", value: "high" },
            ],
          },
        ],
      },
    });
  });

  it("returns the long-running operation's name as the launch result", async () => {
    mockRunJob.mockResolvedValue([{ name: "projects/kanban-app-fa4b7/locations/europe-west2/operations/op-2" }]);

    const result = await launchAdaExecutorJob({ executionRequestId: "req-2" });

    expect(result).toEqual({ operationName: "projects/kanban-app-fa4b7/locations/europe-west2/operations/op-2" });
  });

  it("propagates a launch failure instead of swallowing it", async () => {
    mockRunJob.mockRejectedValue(Object.assign(new Error("permission denied"), { code: 7 }));

    await expect(launchAdaExecutorJob({ executionRequestId: "req-3" })).rejects.toThrow("permission denied");
  });

  it("fails closed on a missing CODEX_MODEL without calling the Cloud Run Admin API", async () => {
    vi.stubEnv("ADA_CODEX_MODEL", "");

    await expect(launchAdaExecutorJob({ executionRequestId: "req-4" })).rejects.toThrow(AdaCodexModelConfigError);

    expect(mockRunJob).not.toHaveBeenCalled();
  });

  it("fails closed on an unapproved CODEX_MODEL without calling the Cloud Run Admin API", async () => {
    vi.stubEnv("ADA_CODEX_MODEL", "gpt-5.6-nova");

    await expect(launchAdaExecutorJob({ executionRequestId: "req-5" })).rejects.toThrow(AdaCodexModelConfigError);

    expect(mockRunJob).not.toHaveBeenCalled();
  });

  it("fails closed on an unapproved CODEX_REASONING_EFFORT without calling the Cloud Run Admin API", async () => {
    vi.stubEnv("ADA_CODEX_REASONING_EFFORT", "ultra");

    await expect(launchAdaExecutorJob({ executionRequestId: "req-6" })).rejects.toThrow(AdaCodexModelConfigError);

    expect(mockRunJob).not.toHaveBeenCalled();
  });
});

describe("launchAdaExecutorJobInEmulator", () => {
  it("never constructs a real JobsClient or calls runJob", async () => {
    await launchAdaExecutorJobInEmulator({ executionRequestId: "req-1" });

    expect(mockJobPath).not.toHaveBeenCalled();
    expect(mockRunJob).not.toHaveBeenCalled();
  });

  it("returns a synthetic result so the handler still logs a launch outcome", async () => {
    const result = await launchAdaExecutorJobInEmulator({ executionRequestId: "req-1" });

    expect(result.operationName).toContain("req-1");
  });
});
