import { beforeAll, describe, expect, it } from "vitest";
import { AwsFactoryStateStore } from "@software-factory/core";
import { createHarnessToolHandler } from "./index.js";

const hasAwsEndpoint = Boolean(process.env.AWS_ENDPOINT_URL);

describe.skipIf(!hasAwsEndpoint)(
  "AgentCore Harness Tools AWS Integration (S3 + DynamoDB in eu-west-2)",
  () => {
    let store: AwsFactoryStateStore;

    beforeAll(async () => {
      store = new AwsFactoryStateStore({
        bucketName:
          process.env.ARTIFACTS_BUCKET ?? "software-factory-ci-artifacts",
        tableName: process.env.STATE_TABLE_NAME ?? "software-factory-ci-runs",
        region: process.env.AWS_REGION ?? "eu-west-2",
        endpoint: process.env.AWS_ENDPOINT_URL,
      });
      await store.ensureStorageResources();
    });

    it("executes write_code_artifact, read_spec_or_artifact, and get_run_state against S3 and DynamoDB", async () => {
      const handler = createHarnessToolHandler(store);
      const runId = `tool_int_${Date.now()}`;

      await store.saveRun({
        runId,
        repository: "jps/software-factory",
        featurePrompt: "Verify tool handler against S3 & DynamoDB",
        status: "BUILDING",
        attempt: 1,
        updatedAt: new Date().toISOString(),
      });

      const writeOut = await handler({
        toolName: "write_code_artifact",
        arguments: {
          runId,
          attempt: 1,
          filePath: "src/service.ts",
          content: "export const region = 'eu-west-2';",
        },
      });
      expect(writeOut).toHaveProperty("written", true);

      const readOut = await handler({
        toolName: "read_spec_or_artifact",
        arguments: {
          s3Key: `runs/${runId}/attempts/1/files/src/service.ts`,
        },
      });
      expect(readOut).toMatchObject({
        found: true,
        artifact: {
          filePath: "src/service.ts",
          content: "export const region = 'eu-west-2';",
        },
      });

      const runStateOut = await handler({
        toolName: "get_run_state",
        arguments: { runId },
      });
      expect(runStateOut).toMatchObject({
        found: true,
        run: {
          runId,
          status: "BUILDING",
        },
      });
    });
  },
);
