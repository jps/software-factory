import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  PutObjectCommand,
  GetObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { FactoryRunRecord, FactoryRunStatus } from "./schemas.js";

export interface FactoryStateStore {
  saveRun(record: FactoryRunRecord): Promise<void>;
  getRun(runId: string): Promise<FactoryRunRecord | undefined>;
  updateStatus(
    runId: string,
    status: FactoryRunStatus,
    patch?: Partial<FactoryRunRecord>,
  ): Promise<FactoryRunRecord>;
  writeArtifactJson(key: string, payload: unknown): Promise<string>;
  readArtifactJson<T>(key: string): Promise<T | undefined>;
}

/**
 * In-memory state and artifact store for fast local durable workflow execution
 * and unit testing without requiring live AWS credentials.
 */
export class InMemoryFactoryStateStore implements FactoryStateStore {
  private readonly runs = new Map<string, FactoryRunRecord>();
  private readonly artifacts = new Map<string, string>();
  private readonly bucketName: string;

  constructor(bucketName = "software-factory-local-artifacts") {
    this.bucketName = bucketName;
  }

  async saveRun(record: FactoryRunRecord): Promise<void> {
    this.runs.set(record.runId, { ...record });
  }

  async getRun(runId: string): Promise<FactoryRunRecord | undefined> {
    const item = this.runs.get(runId);
    return item ? { ...item } : undefined;
  }

  async updateStatus(
    runId: string,
    status: FactoryRunStatus,
    patch?: Partial<FactoryRunRecord>,
  ): Promise<FactoryRunRecord> {
    const existing = this.runs.get(runId);
    if (!existing) {
      throw new Error(`Factory run not found: ${runId}`);
    }
    const updated: FactoryRunRecord = {
      ...existing,
      ...patch,
      status,
      updatedAt: new Date().toISOString(),
    };
    this.runs.set(runId, updated);
    return { ...updated };
  }

  async writeArtifactJson(key: string, payload: unknown): Promise<string> {
    this.artifacts.set(key, JSON.stringify(payload, null, 2));
    return `s3://${this.bucketName}/${key}`;
  }

  async readArtifactJson<T>(key: string): Promise<T | undefined> {
    const raw = this.artifacts.get(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  }
}

/**
 * Production AWS S3 + DynamoDB store backing the Software Factory blueprint.
 * - DynamoDB tracks active factory session state, attempts, and callback IDs.
 * - S3 stores durable specifications, code bundles, and QA/security reports.
 */
export class AwsFactoryStateStore implements FactoryStateStore {
  private readonly ddb: DynamoDBDocumentClient;
  private readonly s3: S3Client;
  private readonly tableName: string;
  private readonly bucketName: string;

  constructor(options?: {
    tableName?: string;
    bucketName?: string;
    region?: string;
  }) {
    const region = options?.region ?? process.env.AWS_REGION ?? "eu-west-2";
    this.tableName =
      options?.tableName ??
      process.env.STATE_TABLE_NAME ??
      "software-factory-runs";
    this.bucketName =
      options?.bucketName ??
      process.env.ARTIFACTS_BUCKET ??
      "software-factory-artifacts";

    this.ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
      marshallOptions: { removeUndefinedValues: true },
    });
    this.s3 = new S3Client({ region });
  }

  async saveRun(record: FactoryRunRecord): Promise<void> {
    await this.ddb.send(
      new PutCommand({
        TableName: this.tableName,
        Item: record,
      }),
    );
  }

  async getRun(runId: string): Promise<FactoryRunRecord | undefined> {
    const response = await this.ddb.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { runId },
      }),
    );
    return response.Item as FactoryRunRecord | undefined;
  }

  async updateStatus(
    runId: string,
    status: FactoryRunStatus,
    patch?: Partial<FactoryRunRecord>,
  ): Promise<FactoryRunRecord> {
    const current = await this.getRun(runId);
    const updated: FactoryRunRecord = {
      ...(current ?? {
        runId,
        repository: "unknown",
        featurePrompt: "",
        attempt: 1,
      }),
      ...patch,
      status,
      updatedAt: new Date().toISOString(),
    };
    await this.saveRun(updated);
    return updated;
  }

  async writeArtifactJson(key: string, payload: unknown): Promise<string> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: JSON.stringify(payload, null, 2),
        ContentType: "application/json",
      }),
    );
    return `s3://${this.bucketName}/${key}`;
  }

  async readArtifactJson<T>(key: string): Promise<T | undefined> {
    const out = await this.s3.send(
      new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      }),
    );
    if (!out.Body) return undefined;
    const text = await out.Body.transformToString();
    return JSON.parse(text) as T;
  }
}
