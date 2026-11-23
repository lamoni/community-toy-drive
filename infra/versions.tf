terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.80, < 7.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.6"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Recommended for anything beyond a quick trial: keep state in S3 so it isn't lost
  # with your laptop. Create the bucket first, then uncomment and run `terraform init`.
  # backend "s3" {
  #   bucket       = "my-terraform-state-bucket"
  #   key          = "toy-drive/terraform.tfstate"
  #   region       = "us-east-1"
  #   use_lockfile = true
  # }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = { Project = var.project_name }
  }
}

# CloudFront certificates must live in us-east-1.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
  default_tags {
    tags = { Project = var.project_name }
  }
}
