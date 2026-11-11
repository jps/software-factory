variable "harness_name" {
  type = string
}

variable "role_key" {
  type = string
}

variable "model_id" {
  type = string
}

variable "temperature" {
  type    = number
  default = 0.2
}

variable "system_prompt" {
  type = string
}

variable "artifacts_bucket_arn" {
  type = string
}

variable "state_table_arn" {
  type = string
}

data "aws_iam_policy_document" "harness_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["bedrock-agentcore.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "harness_execution" {
  name               = "${var.harness_name}-harness-role"
  assume_role_policy = data.aws_iam_policy_document.harness_assume_role.json
}

resource "aws_iam_role_policy" "harness_permissions" {
  name = "${var.harness_name}-policy"
  role = aws_iam_role.harness_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "BedrockModelInference"
        Effect = "Allow"
        Action = [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream"
        ]
        Resource = "*"
      },
      {
        Sid    = "ArtifactsBucketAccess"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:ListBucket"
        ]
        Resource = [
          var.artifacts_bucket_arn,
          "${var.artifacts_bucket_arn}/*"
        ]
      },
      {
        Sid    = "StateTableRead"
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:Query"
        ]
        Resource = [var.state_table_arn]
      }
    ]
  })
}

resource "aws_bedrockagentcore_harness" "this" {
  harness_name       = replace(var.harness_name, "-", "_")
  execution_role_arn = aws_iam_role.harness_execution.arn

  model {
    bedrock_model_config {
      model_id    = var.model_id
      temperature = var.temperature
      top_p       = 0.9
    }
  }

  system_prompt {
    text = var.system_prompt
  }

  allowed_tools   = ["*"]
  max_iterations  = 15
  max_tokens      = 8192
  timeout_seconds = 300

  tool {
    type = "inline_function"
    name = "read_spec_or_artifact"
    config {
      inline_function {
        description = "Read a specification, code artifact, or QA report from the S3 artifacts store"
        input_schema = jsonencode({
          type = "object"
          properties = {
            s3Key = {
              type        = "string"
              description = "Object key inside the Software Factory artifacts S3 bucket"
            }
          }
          required = ["s3Key"]
        })
      }
    }
  }

  tool {
    type = "inline_function"
    name = "write_code_artifact"
    config {
      inline_function {
        description = "Write a generated source file or test artifact to the S3 artifacts store"
        input_schema = jsonencode({
          type = "object"
          properties = {
            runId = {
              type        = "string"
              description = "Unique Software Factory run identifier"
            }
            attempt = {
              type        = "integer"
              description = "Refinement iteration number"
            }
            filePath = {
              type        = "string"
              description = "Repository-relative file path"
            }
            content = {
              type        = "string"
              description = "Full file content"
            }
          }
          required = ["runId", "attempt", "filePath", "content"]
        })
      }
    }
  }

  truncation {
    strategy = "sliding_window"
    config {
      sliding_window {
        messages_count = 40
      }
    }
  }
}

output "harness_id" {
  value = aws_bedrockagentcore_harness.this.harness_id
}

output "harness_arn" {
  value = aws_bedrockagentcore_harness.this.arn
}
