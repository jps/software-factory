variable "name_prefix" {
  type = string
}

variable "artifacts_bucket_name" {
  type = string
}

variable "artifacts_bucket_arn" {
  type = string
}

variable "state_table_name" {
  type = string
}

variable "state_table_arn" {
  type = string
}

variable "agentcore_memory_id" {
  type = string
}

variable "harness_ids" {
  type = map(string)
}

variable "harness_arns" {
  type = list(string)
}

variable "durable_execution_timeout_seconds" {
  type    = number
  default = 900
}

variable "durable_retention_days" {
  type    = number
  default = 7
}

variable "orchestrator_zip_path" {
  type = string
}

variable "tools_zip_path" {
  type = string
}

data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "durable_orchestrator" {
  name               = "${var.name_prefix}-durable-orchestrator-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

# Standard CloudWatch Logs permissions
resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.durable_orchestrator.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# AWS Lambda Durable Execution checkpointing and callback management policy
resource "aws_iam_role_policy_attachment" "lambda_durable" {
  role       = aws_iam_role.durable_orchestrator.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicDurableExecutionRolePolicy"
}

resource "aws_iam_role_policy" "orchestrator_factory_access" {
  name = "${var.name_prefix}-orchestrator-factory-access"
  role = aws_iam_role.durable_orchestrator.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "InvokeSpecialistAgentCoreHarnesses"
        Effect = "Allow"
        Action = [
          "bedrock-agentcore:InvokeHarness",
          "bedrock-agentcore:GetHarness"
        ]
        Resource = var.harness_arns
      },
      {
        Sid    = "ManageFactoryStateTable"
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:Query"
        ]
        Resource = [var.state_table_arn]
      },
      {
        Sid    = "ReadWriteFactoryArtifacts"
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
      }
    ]
  })
}

# AWS Lambda Durable Function replacing Step Functions ASL state machines
resource "aws_lambda_function" "durable_orchestrator" {
  filename         = var.orchestrator_zip_path
  source_code_hash = filebase64sha256(var.orchestrator_zip_path)
  function_name    = "${var.name_prefix}-durable-orchestrator"
  role             = aws_iam_role.durable_orchestrator.arn
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  timeout          = 60
  memory_size      = 512

  durable_config {
    execution_timeout = var.durable_execution_timeout_seconds
    retention_period  = var.durable_retention_days
  }

  environment {
    variables = {
      ARTIFACTS_BUCKET     = var.artifacts_bucket_name
      STATE_TABLE_NAME     = var.state_table_name
      AGENTCORE_MEMORY_ID  = var.agentcore_memory_id
      ARCHITECT_HARNESS_ID = lookup(var.harness_ids, "architect", "")
      BUILDER_HARNESS_ID   = lookup(var.harness_ids, "builder", "")
      TESTER_HARNESS_ID    = lookup(var.harness_ids, "tester", "")
      REVIEWER_HARNESS_ID  = lookup(var.harness_ids, "reviewer", "")
    }
  }
}

# Lambda function executing AgentCore Harness tool actions against S3 & DynamoDB
resource "aws_lambda_function" "harness_tools" {
  filename         = var.tools_zip_path
  source_code_hash = filebase64sha256(var.tools_zip_path)
  function_name    = "${var.name_prefix}-harness-tools"
  role             = aws_iam_role.durable_orchestrator.arn
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  timeout          = 30
  memory_size      = 256

  environment {
    variables = {
      ARTIFACTS_BUCKET = var.artifacts_bucket_name
      STATE_TABLE_NAME = var.state_table_name
    }
  }
}

output "orchestrator_function_name" {
  value = aws_lambda_function.durable_orchestrator.function_name
}

output "orchestrator_function_arn" {
  value = aws_lambda_function.durable_orchestrator.arn
}

output "tools_function_arn" {
  value = aws_lambda_function.harness_tools.arn
}
