import {
  type AgentCoreHarnessAdapter,
  ArchitectSpecSchema,
  type ArchitectSpec,
  BuildArtifactSchema,
  type BuildArtifact,
  FactoryRunRequestSchema,
  type FactoryRunRequest,
  type FactoryRunStatus,
  type FactoryStateStore,
  HumanApprovalDecisionSchema,
  type HumanApprovalDecision,
  InMemoryFactoryStateStore,
  QAReportSchema,
  type QAReport,
  ReviewVerdictSchema,
  type ReviewVerdict,
  SimulatedHarnessAdapter,
  getHarnessEndpointsFromEnv,
} from "@software-factory/core";
import {
  type DurableContext,
  withDurableExecution,
} from "./durable-runtime.js";

export interface SoftwareFactoryDependencies {
  harness: AgentCoreHarnessAdapter;
  stateStore: FactoryStateStore;
}

export interface SoftwareFactoryRunOutput {
  runId: string;
  status: FactoryRunStatus;
  attemptsUsed: number;
  spec: ArchitectSpec;
  buildArtifact?: BuildArtifact;
  qaReport?: QAReport;
  reviewVerdict?: ReviewVerdict;
  humanApproval?: HumanApprovalDecision;
}

/**
 * Creates the Software Factory Durable Workflow using `@aws/durable-execution-sdk-js`
 * semantics (`context.step`, `context.wait`, `context.waitForCallback`).
 *
 * Replaces AWS Step Functions ASL JSON with clean, sequential TypeScript `async/await`
 * while retaining deterministic checkpointing, replay safety, and zero-idle-compute waits.
 */
export function createSoftwareFactoryWorkflow(
  deps?: Partial<SoftwareFactoryDependencies>,
) {
  const harness = deps?.harness ?? new SimulatedHarnessAdapter();
  const stateStore = deps?.stateStore ?? new InMemoryFactoryStateStore();
  const endpoints = getHarnessEndpointsFromEnv();

  return async (
    rawEvent: FactoryRunRequest,
    context: DurableContext,
  ): Promise<SoftwareFactoryRunOutput> => {
    const request = FactoryRunRequestSchema.parse(rawEvent);
    const { runId, repository, featurePrompt, maxRefinementAttempts } = request;

    // Step 1: Initialize run state in DynamoDB
    await context.step("initialize-factory-run", async () => {
      await stateStore.saveRun({
        runId,
        repository,
        featurePrompt,
        status: "INITIALIZED",
        attempt: 1,
        updatedAt: new Date().toISOString(),
      });
      return { initialized: true };
    });

    // Step 2: Architect AgentCore Harness generates specification & ADR
    const spec = await context.step("architect-spec-generation", async () => {
      await stateStore.updateStatus(runId, "ARCHITECTING");

      const generatedSpec = await harness.invoke(
        {
          role: "architect",
          harnessIdentifier: endpoints.architect,
          sessionId: `${runId}-architect`,
          prompt: featurePrompt,
          context: { runId, repository, memoryId: endpoints.memoryId },
        },
        (raw) => ArchitectSpecSchema.parse(raw),
      );

      const specS3Uri = await stateStore.writeArtifactJson(
        `runs/${runId}/spec.json`,
        generatedSpec,
      );

      await stateStore.updateStatus(runId, "ARCHITECTING", { specS3Uri });
      return { ...generatedSpec, specS3Uri };
    });

    // Optional Step 3: Human-in-the-Loop Spec Approval Gate (Zero-idle-cost suspension)
    let humanApproval: HumanApprovalDecision | undefined;
    if (request.requireHumanApproval) {
      const rawApproval = await context.waitForCallback<HumanApprovalDecision>(
        "human-spec-approval",
        async (callbackId) => {
          await stateStore.updateStatus(runId, "AWAITING_HUMAN_APPROVAL", {
            pendingCallbackId: callbackId,
          });
        },
        { timeout: { hours: 24 } },
      );

      humanApproval = HumanApprovalDecisionSchema.parse(rawApproval);

      if (!humanApproval.approved) {
        await context.step("record-spec-rejection", async () => {
          await stateStore.updateStatus(runId, "REJECTED", {
            pendingCallbackId: undefined,
          });
        });

        return {
          runId,
          status: "REJECTED",
          attemptsUsed: 0,
          spec,
          humanApproval,
        };
      }
    }

    // Step 4: Iterative Builder <-> Tester <-> Reviewer refinement loop
    let lastBuild: BuildArtifact | undefined;
    let lastQa: QAReport | undefined;
    let lastReview: ReviewVerdict | undefined;
    let refinementFeedback: string[] = [];

    for (let attempt = 1; attempt <= maxRefinementAttempts; attempt++) {
      // 4a. Builder AgentCore Harness implements code against spec + feedback
      lastBuild = await context.step(
        `builder-implementation-attempt-${attempt}`,
        async () => {
          await stateStore.updateStatus(runId, "BUILDING", { attempt });

          const buildResult = await harness.invoke(
            {
              role: "builder",
              harnessIdentifier: endpoints.builder,
              sessionId: `${runId}-builder`,
              prompt:
                refinementFeedback.length > 0
                  ? `Refine implementation for ${featurePrompt}. Address feedback:\n${refinementFeedback.join("\n")}`
                  : `Implement feature per specification: ${spec.summary}`,
              context: {
                runId,
                repository,
                attempt,
                spec,
                refinementFeedback,
                memoryId: endpoints.memoryId,
              },
            },
            (raw) => BuildArtifactSchema.parse(raw),
          );

          const bundleS3Uri = await stateStore.writeArtifactJson(
            `runs/${runId}/attempts/${attempt}/bundle.json`,
            buildResult,
          );

          await stateStore.updateStatus(runId, "BUILDING", { bundleS3Uri });
          return { ...buildResult, bundleS3Uri };
        },
      );

      // 4b. Tester AgentCore Harness validates test suite & coverage
      lastQa = await context.step(
        `tester-qa-attempt-${attempt}`,
        async () => {
          await stateStore.updateStatus(runId, "TESTING", { attempt });

          const qaReport = await harness.invoke(
            {
              role: "tester",
              harnessIdentifier: endpoints.tester,
              sessionId: `${runId}-tester`,
              prompt: `Run verification suite for attempt ${attempt}`,
              context: {
                runId,
                attempt,
                spec,
                buildArtifact: lastBuild,
              },
            },
            (raw) => QAReportSchema.parse(raw),
          );

          await stateStore.writeArtifactJson(
            `runs/${runId}/attempts/${attempt}/qa-report.json`,
            qaReport,
          );
          return qaReport;
        },
      );

      // 4c. Reviewer AgentCore Harness performs security & architectural review
      lastReview = await context.step(
        `reviewer-security-attempt-${attempt}`,
        async () => {
          await stateStore.updateStatus(runId, "REVIEWING", { attempt });

          const verdict = await harness.invoke(
            {
              role: "reviewer",
              harnessIdentifier: endpoints.reviewer,
              sessionId: `${runId}-reviewer`,
              prompt: `Audit security and code quality for attempt ${attempt}`,
              context: {
                runId,
                attempt,
                spec,
                buildArtifact: lastBuild,
                qaReport: lastQa,
              },
            },
            (raw) => ReviewVerdictSchema.parse(raw),
          );

          await stateStore.writeArtifactJson(
            `runs/${runId}/attempts/${attempt}/review-verdict.json`,
            verdict,
          );
          return verdict;
        },
      );

      const hasBlockingSecurityFinding = lastReview.securityFindings.some(
        (f) => f.severity === "HIGH" || f.severity === "CRITICAL",
      );

      if (
        lastQa.passed &&
        lastReview.approved &&
        !hasBlockingSecurityFinding
      ) {
        await context.step("finalize-factory-run-success", async () => {
          await stateStore.updateStatus(runId, "COMPLETED", { attempt });
        });

        return {
          runId,
          status: "COMPLETED",
          attemptsUsed: attempt,
          spec,
          buildArtifact: lastBuild,
          qaReport: lastQa,
          reviewVerdict: lastReview,
          humanApproval,
        };
      }

      // Collect feedback for the next refinement iteration
      refinementFeedback = [
        ...lastQa.failures.map((f) => `[QA Failure] ${f}`),
        ...lastReview.feedback.map((f) => `[Review Feedback] ${f}`),
        ...lastReview.securityFindings.map(
          (s) => `[Security ${s.severity}] ${s.description}`,
        ),
      ];
    }

    // Max refinement attempts exhausted
    await context.step("finalize-factory-run-failed", async () => {
      await stateStore.updateStatus(runId, "FAILED", {
        attempt: maxRefinementAttempts,
      });
    });

    return {
      runId,
      status: "FAILED",
      attemptsUsed: maxRefinementAttempts,
      spec,
      buildArtifact: lastBuild,
      qaReport: lastQa,
      reviewVerdict: lastReview,
      humanApproval,
    };
  };
}

/**
 * Default AWS Lambda Durable Function Handler exported for `aws_lambda_function.durable_orchestrator`.
 */
export const handler = withDurableExecution(createSoftwareFactoryWorkflow());
