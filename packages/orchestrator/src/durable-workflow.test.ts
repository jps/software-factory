import { describe, expect, it } from "vitest";
import {
  InMemoryFactoryStateStore,
  SimulatedHarnessAdapter,
} from "@software-factory/core";
import {
  DurableExecutionSuspendedError,
  LocalDurableTestRunner,
} from "./durable-runtime.js";
import { createSoftwareFactoryWorkflow } from "./durable-workflow.js";

describe("Software Factory Durable Workflow", () => {
  it("completes a full Architect -> Builder -> Tester -> Reviewer pipeline on first attempt", async () => {
    const stateStore = new InMemoryFactoryStateStore();
    const harness = new SimulatedHarnessAdapter({ failFirstAttempt: false });
    const workflow = createSoftwareFactoryWorkflow({ harness, stateStore });
    const runner = new LocalDurableTestRunner(workflow);

    const output = await runner.run({
      runId: "run_happy_path",
      repository: "org/service-a",
      featurePrompt: "Create healthcheck endpoint /healthz",
      requireHumanApproval: false,
      maxRefinementAttempts: 2,
    });

    expect(output.status).toBe("COMPLETED");
    expect(output.attemptsUsed).toBe(1);
    expect(output.qaReport?.passed).toBe(true);
    expect(output.reviewVerdict?.approved).toBe(true);

    const saved = await stateStore.getRun("run_happy_path");
    expect(saved?.status).toBe("COMPLETED");
  });

  it("self-heals when QA fails on attempt 1 and succeeds on attempt 2", async () => {
    const stateStore = new InMemoryFactoryStateStore();
    const harness = new SimulatedHarnessAdapter({ failFirstAttempt: true });
    const workflow = createSoftwareFactoryWorkflow({ harness, stateStore });
    const runner = new LocalDurableTestRunner(workflow);

    const output = await runner.run({
      runId: "run_self_heal",
      repository: "org/service-b",
      featurePrompt: "Implement rate limiter middleware",
      requireHumanApproval: false,
      maxRefinementAttempts: 2,
    });

    expect(output.status).toBe("COMPLETED");
    expect(output.attemptsUsed).toBe(2);
    expect(
      runner.traces.map((t) => t.name),
    ).toContain("builder-implementation-attempt-2");
  });

  it("suspends at waitForCallback for human approval and replays prior steps without re-executing", async () => {
    const stateStore = new InMemoryFactoryStateStore();
    const harness = new SimulatedHarnessAdapter({ failFirstAttempt: false });
    const workflow = createSoftwareFactoryWorkflow({ harness, stateStore });
    const runner = new LocalDurableTestRunner(workflow);

    const request = {
      runId: "run_hil_001",
      repository: "org/critical-billing",
      featurePrompt: "Update ledger settlement calculation",
      requireHumanApproval: true,
      maxRefinementAttempts: 2,
    };

    // First invocation suspends at the human-spec-approval callback gate
    await expect(runner.run(request)).rejects.toThrow(
      DurableExecutionSuspendedError,
    );

    const pausedState = await stateStore.getRun("run_hil_001");
    expect(pausedState?.status).toBe("AWAITING_HUMAN_APPROVAL");
    expect(pausedState?.pendingCallbackId).toBe("cb_human-spec-approval");

    // External human approver sends callback payload (`SendDurableExecutionCallbackSuccess`)
    runner.resolveCallback("human-spec-approval", {
      approved: true,
      reviewerId: "staff-eng@example.com",
      comments: "Spec LGTM, proceed with build.",
    });

    // Clear trace log to inspect replay behavior on resume
    runner.traces.length = 0;

    // Resumed invocation replays `initialize-factory-run` and `architect-spec-generation` from checkpoints
    const finalOutput = await runner.run(request);
    expect(finalOutput.status).toBe("COMPLETED");
    expect(finalOutput.humanApproval?.approved).toBe(true);

    const initTrace = runner.traces.find(
      (t) => t.name === "initialize-factory-run",
    );
    const archTrace = runner.traces.find(
      (t) => t.name === "architect-spec-generation",
    );
    expect(initTrace?.replayed).toBe(true);
    expect(archTrace?.replayed).toBe(true);
  });
});
