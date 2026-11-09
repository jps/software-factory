variable "project_name" {
  description = "Name prefix for all Software Factory resources"
  type        = string
  default     = "software-factory"
}

variable "environment" {
  description = "Deployment environment (dev, staging, prod)"
  type        = string
  default     = "dev"
}

variable "aws_region" {
  description = "AWS region supporting Bedrock AgentCore Harness and Lambda Durable Functions"
  type        = string
  default     = "us-east-1"
}

variable "foundation_model_id" {
  description = "Amazon Bedrock foundation model ID used by the AgentCore Harnesses"
  type        = string
  default     = "anthropic.claude-sonnet-4-20250514"
}

variable "memory_event_expiry_days" {
  description = "Retention period in days for Bedrock AgentCore Memory events"
  type        = number
  default     = 30
}

variable "durable_execution_timeout_seconds" {
  description = "Maximum execution timeout (in seconds) for the Lambda Durable Function workflow"
  type        = number
  default     = 900
}

variable "durable_retention_days" {
  description = "Days to retain Lambda Durable Execution checkpoints and history"
  type        = number
  default     = 7
}
