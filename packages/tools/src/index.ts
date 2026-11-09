import { z } from "zod";
import {
  AwsFactoryStateStore,
  type FactoryStateStore,
  InMemoryFactoryStateStore,
} from "@software-factory/core";

export const ToolInvocationSchema = z.discriminatedUnion("toolName", [
  z.object({
    toolName: z.literal("read_spec_or_artifact"),
    arguments: z.object({
      s3Key: z.string().min(1),
    }),
  }),
  z.object({
    toolName: z.literal("write_code_artifact"),
    arguments: z.object({
      runId: z.string().min(1),
      attempt: z.number().int().min(1),
      filePath: z.string().min(1),
      content: z.string(),
    }),
  }),
  z.object({
    toolName: z.literal("get_run_state"),
    arguments: z.object({
      runId: z.string().min(1),
    }),
  }),
]);

export type ToolInvocation = z.infer<typeof ToolInvocationSchema>;

export function createHarnessToolHandler(stateStore?: FactoryStateStore) {
  const store =
    stateStore ??
    (process.env.STATE_TABLE_NAME
      ? new AwsFactoryStateStore()
      : new InMemoryFactoryStateStore());

  return async (rawEvent: unknown) => {
    const invocation = ToolInvocationSchema.parse(rawEvent);

    switch (invocation.toolName) {
      case "read_spec_or_artifact": {
        const artifact = await store.readArtifactJson(
          invocation.arguments.s3Key,
        );
        return {
          found: artifact !== undefined,
          s3Key: invocation.arguments.s3Key,
          artifact: artifact ?? null,
        };
      }

      case "write_code_artifact": {
        const { runId, attempt, filePath, content } = invocation.arguments;
        const key = `runs/${runId}/attempts/${attempt}/files/${filePath}`;
        const uri = await store.writeArtifactJson(key, {
          filePath,
          content,
          writtenAt: new Date().toISOString(),
        });
        return {
          written: true,
          s3Key: key,
          s3Uri: uri,
        };
      }

      case "get_run_state": {
        const run = await store.getRun(invocation.arguments.runId);
        return {
          found: run !== undefined,
          run: run ?? null,
        };
      }
    }
  };
}

export const handler = createHarnessToolHandler();
