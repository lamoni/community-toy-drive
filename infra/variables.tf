variable "project_name" {
  description = "Short name used to prefix AWS resources (lowercase letters, numbers, hyphens)."
  type        = string
  default     = "toy-drive"

  validation {
    condition     = can(regex("^[a-z0-9-]{3,30}$", var.project_name))
    error_message = "project_name must be 3-30 characters of lowercase letters, numbers and hyphens."
  }
}

variable "aws_region" {
  description = "AWS region for the API, Lambda function, DynamoDB tables and S3 bucket."
  type        = string
  default     = "us-east-1"
}

variable "admin_password" {
  description = "Password for the /admin dashboard (username is \"admin\"). Use a long random value."
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.admin_password) >= 12
    error_message = "admin_password must be at least 12 characters."
  }
}

variable "domain_name" {
  description = "Optional custom domain (e.g. sodaspringstoydrive.org). Leave empty to use the CloudFront URL."
  type        = string
  default     = ""
}

variable "route53_zone_id" {
  description = "Existing Route 53 hosted zone ID for domain_name. Leave empty if create_route53_zone is true."
  type        = string
  default     = ""
}

variable "create_route53_zone" {
  description = "Create a new Route 53 hosted zone for domain_name (use when the domain is registered elsewhere, e.g. Namecheap, then point its nameservers at the zone)."
  type        = bool
  default     = false
}

variable "include_www" {
  description = "Also serve www.<domain_name>, redirecting it to the bare domain."
  type        = bool
  default     = true
}

variable "mx_records" {
  description = "Mail (MX) records for domain_name, e.g. [\"10 mx1.improvmx.com\", \"20 mx2.improvmx.com\"]. Requires a Route 53 zone."
  type        = list(string)
  default     = []
}

variable "txt_records" {
  description = "TXT records for domain_name, e.g. an SPF record for your email provider."
  type        = list(string)
  default     = []
}

variable "dmarc_record" {
  description = "Optional DMARC policy published at _dmarc.<domain_name>, e.g. \"v=DMARC1; p=none;\"."
  type        = string
  default     = ""
}

variable "cloudfront_price_class" {
  description = "CloudFront price class. PriceClass_100 (US, Canada, Europe) is cheapest."
  type        = string
  default     = "PriceClass_100"
}

variable "api_throttle_rate" {
  description = "Steady-state requests per second allowed to the API."
  type        = number
  default     = 10
}

variable "api_throttle_burst" {
  description = "Burst requests allowed to the API."
  type        = number
  default     = 20
}

variable "log_retention_days" {
  description = "How long to keep Lambda logs."
  type        = number
  default     = 30
}
