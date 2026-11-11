import { z } from "zod";

export const AgentRoleSchema = z.enum([
  "architect",
  "builder",
  "tester",
  "reviewer",
]);
export type AgentRole = z.infer<typeof AgentRoleSchema>;

export const FactoryRunRequestSchema = z.object({
  runId: z.string().min(1),
  repository: z.string().min(1),
  featurePrompt: z.string().min(1),
  requireHumanApproval: z.boolean().default(false),
  maxRefinementAttempts: z.number().int().min(1).max(5).default(2),
});
export type FactoryRunRequest = z.infer<typeof FactoryRunRequestSchema>;

export const ArchitectSpecSchema = z.object({
  summary: z.string(),
  architectureDecisions: z.array(z.string()),
  targetFiles: z.array(
    z.object({
      path: z.string(),
      action: z.enum(["create", "modify", "delete"]),
      purpose: z.string(),
    }),
  ),
  acceptanceCriteria: z.array(z.string()),
  specS3Uri: z.string(),
});
export type ArchitectSpec = z.infer<typeof ArchitectSpecSchema>;

export const HumanApprovalDecisionSchema = z.object({
  approved: z.boolean(),
  reviewerId: z.string(),
  comments: z.string().optional(),
});
export type HumanApprovalDecision = z.infer<typeof HumanApprovalDecisionSchema>;

export const BuildArtifactSchema = z.object({
  attempt: z.number().int().min(1),
  modifiedFiles: z.array(
    z.object({
      path: z.string(),
      s3Key: z.string(),
      linesChanged: z.number().int().nonnegative(),
    }),
  ),
  commitSummary: z.string(),
  bundleS3Uri: z.string(),
});
export type BuildArtifact = z.infer<typeof BuildArtifactSchema>;

export const QAReportSchema = z.object({
  passed: z.boolean(),
  totalTests: z.number().int().nonnegative(),
  failedTests: z.number().int().nonnegative(),
  coveragePercent: z.number().min(0).max(100),
  failures: z.array(z.string()),
});
export type QAReport = z.infer<typeof QAReportSchema>;

export const ReviewVerdictSchema = z.object({
  approved: z.boolean(),
  securityFindings: z.array(
    z.object({
      severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
      description: z.string(),
      file: z.string().optional(),
    }),
  ),
  feedback: z.array(z.string()),
});
export type ReviewVerdict = z.infer<typeof ReviewVerdictSchema>;

export const FactoryRunStatusSchema = z.enum([
  "INITIALIZED",
  "ARCHITECTING",
  "AWAITING_HUMAN_APPROVAL",
  "BUILDING",
  "TESTING",
  "REVIEWING",
  "COMPLETED",
  "REJECTED",
  "FAILED",
]);
export type FactoryRunStatus = z.infer<typeof FactoryRunStatusSchema>;

export interface FactoryRunRecord {
  runId: string;
  repository: string;
  featurePrompt: string;
  status: FactoryRunStatus;
  attempt: number;
  pendingCallbackId?: string;
  specS3Uri?: string;
  bundleS3Uri?: string;
  updatedAt: string;
}
