import { describe, expect, it } from "vitest";
import { InMemoryFactoryStateStore } from "@software-factory/core";
import { createHarnessToolHandler } from "./index.js";

describe("AgentCore Harness Tool Handler", () => {
  it("writes and reads code artifacts via the state store", async () => {
    const store = new InMemoryFactoryStateStore("test-bucket");
    const toolHandler = createHarnessToolHandler(store);

    const writeRes = await toolHandler({
      toolName: "write_code_artifact",
      arguments: {
        runId: "run_100",
        attempt: 1,
        filePath: "src/index.ts",
        content: "export const ok = true;",
      },
    });

    expect(writeRes).toEqual({
      written: true,
      s3Key: "runs/run_100/attempts/1/files/src/index.ts",
      s3Uri: "s3://test-bucket/runs/run_100/attempts/1/files/src/index.ts",
    });

    const readRes = await toolHandler({
      toolName: "read_spec_or_artifact",
      arguments: {
        s3Key: "runs/run_100/attempts/1/files/src/index.ts",
      },
    });

    expect(readRes.found).toBe(true);
    expect(readRes.artifact).toMatchObject({
      filePath: "src/index.ts",
      content: "export const ok = true;",
    });
  });
});
