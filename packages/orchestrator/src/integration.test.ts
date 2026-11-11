import { beforeAll, describe, expect, it } from "vitest";
import {
  type ArchitectSpec,
  AwsFactoryStateStore,
  type BuildArtifact,
  type QAReport,
  type ReviewVerdict,
  SimulatedHarnessAdapter,
} from "@software-factory/core";
import {
  DurableExecutionSuspendedError,
  LocalDurableTestRunner,
} from "./durable-runtime.js";
import { createSoftwareFactoryWorkflow } from "./durable-workflow.js";

const hasAwsEndpoint = Boolean(process.env.AWS_ENDPOINT_URL);

describe.skipIf(!hasAwsEndpoint)(
  "Software Factory AWS Integration Suite (S3 + DynamoDB in eu-west-2)",
  () => {
    const bucketName =
      process.env.ARTIFACTS_BUCKET ?? "software-factory-ci-artifacts";
    const tableName = process.env.STATE_TABLE_NAME ?? "software-factory-ci-runs";

    let stateStore: AwsFactoryStateStore;

    beforeAll(async () => {
      stateStore = new AwsFactoryStateStore({
        bucketName,
        tableName,
        region: process.env.AWS_REGION ?? "eu-west-2",
        endpoint: process.env.AWS_ENDPOINT_URL,
      });
      await stateStore.ensureStorageResources();
    });

    it("persists specs, self-healing build artifacts, QA reports, and callback state in S3 and DynamoDB", async () => {
      const harness = new SimulatedHarnessAdapter({ failFirstAttempt: true });
      const workflow = createSoftwareFactoryWorkflow({ harness, stateStore });
      const runner = new LocalDurableTestRunner(workflow);

      const runId = `int_run_${Date.now()}`;
      const request = {
        runId,
        repository: "jps/software-factory",
        featurePrompt:
          "Add London region eu-west-2 deployment validation and S3 artifact persistence",
        requireHumanApproval: true,
        maxRefinementAttempts: 2,
      };

      // 1. First execution runs Architect step, writes spec.json to S3, and suspends at human approval gate
      await expect(runner.run(request)).rejects.toThrow(
        DurableExecutionSuspendedError,
      );

      // Verify DynamoDB record is in AWAITING_HUMAN_APPROVAL with callback token
      const ddbPaused = await stateStore.getRun(runId);
      expect(ddbPaused).toBeDefined();
      expect(ddbPaused?.status).toBe("AWAITING_HUMAN_APPROVAL");
      expect(ddbPaused?.pendingCallbackId).toBe("cb_human-spec-approval");

      // Verify Architect Spec was written to S3 bucket
      const s3Spec = await stateStore.readArtifactJson<ArchitectSpec>(
        `runs/${runId}/spec.json`,
      );
      expect(s3Spec).toBeDefined();
      expect(s3Spec?.summary).toContain(request.featurePrompt);

      // 2. Deliver human approval callback and resume workflow
      runner.resolveCallback("human-spec-approval", {
        approved: true,
        reviewerId: "platform-lead@example.com",
        comments: "Approved for eu-west-2 execution",
      });

      const result = await runner.run(request);
      expect(result.status).toBe("COMPLETED");
      expect(result.attemptsUsed).toBe(2);

      // 3. Verify DynamoDB final state is COMPLETED on attempt 2
      const ddbCompleted = await stateStore.getRun(runId);
      expect(ddbCompleted?.status).toBe("COMPLETED");
      expect(ddbCompleted?.attempt).toBe(2);

      // 4. Verify Attempt 1 failed QA report and Attempt 2 passing QA/Review artifacts in S3
      const attempt1Qa = await stateStore.readArtifactJson<QAReport>(
        `runs/${runId}/attempts/1/qa-report.json`,
      );
      expect(attempt1Qa?.passed).toBe(false);

      const attempt2Bundle = await stateStore.readArtifactJson<BuildArtifact>(
        `runs/${runId}/attempts/2/bundle.json`,
      );
      expect(attempt2Bundle?.attempt).toBe(2);

      const attempt2Qa = await stateStore.readArtifactJson<QAReport>(
        `runs/${runId}/attempts/2/qa-report.json`,
      );
      expect(attempt2Qa?.passed).toBe(true);

      const attempt2Review = await stateStore.readArtifactJson<ReviewVerdict>(
        `runs/${runId}/attempts/2/review-verdict.json`,
      );
      expect(attempt2Review?.approved).toBe(true);
    });
  },
);
