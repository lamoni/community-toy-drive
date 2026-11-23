locals {
  root        = "${path.module}/.."
  dist        = "${local.root}/dist"
  site_files  = fileset(local.dist, "**")
  use_domain  = var.domain_name != ""
  zone_id     = var.create_route53_zone ? one(aws_route53_zone.site[*].zone_id) : var.route53_zone_id
  hostnames   = local.use_domain ? concat([var.domain_name], var.include_www ? ["www.${var.domain_name}"] : []) : []
  tables      = toset(["nominations", "signups", "summaries"])
  lambda_name = "${var.project_name}-api"

  lambda_files = concat(
    ["package.json", "site.config.json"],
    tolist(fileset(local.root, "src/*.js")),
    tolist(fileset(local.root, "private/*")),
  )

  mime_types = {
    html = "text/html; charset=utf-8"
    css  = "text/css; charset=utf-8"
    js   = "text/javascript; charset=utf-8"
    json = "application/json"
    svg  = "image/svg+xml"
    png  = "image/png"
    jpg  = "image/jpeg"
    jpeg = "image/jpeg"
    webp = "image/webp"
    ico  = "image/x-icon"
    txt  = "text/plain; charset=utf-8"
    xml  = "application/xml"
  }
}

check "domain_config" {
  assert {
    condition     = !local.use_domain || var.create_route53_zone || var.route53_zone_id != ""
    error_message = "Set route53_zone_id or create_route53_zone = true when domain_name is set."
  }
}

resource "terraform_data" "require_build" {
  lifecycle {
    precondition {
      condition     = length(local.site_files) > 0
      error_message = "dist/ is empty. Run `npm run build` before `terraform apply`."
    }
  }
}

# ---------------------------------------------------------------------------
# Data: DynamoDB
# ---------------------------------------------------------------------------

resource "aws_dynamodb_table" "data" {
  for_each = local.tables

  name                        = "${var.project_name}-${each.key}"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "id"
  deletion_protection_enabled = true

  attribute {
    name = "id"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true
  }

  # A code deploy must never recreate these tables. Terraform will refuse any
  # change that would replace them (for example, renaming the project).
  lifecycle {
    prevent_destroy = true
  }
}

# ---------------------------------------------------------------------------
# API: Lambda + API Gateway HTTP API
# ---------------------------------------------------------------------------

resource "random_password" "origin_secret" {
  length  = 40
  special = false
}

data "archive_file" "lambda" {
  type        = "zip"
  output_path = "${path.module}/.lambda.zip"

  dynamic "source" {
    for_each = toset(local.lambda_files)
    content {
      content  = file("${local.root}/${source.value}")
      filename = source.value
    }
  }
}

resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${local.lambda_name}"
  retention_in_days = var.log_retention_days
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda" {
  name               = "${local.lambda_name}-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "lambda" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.lambda.arn}:*"]
  }

  statement {
    sid = "Data"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:Scan",
    ]
    resources = [for t in aws_dynamodb_table.data : t.arn]
  }
}

resource "aws_iam_role_policy" "lambda" {
  name   = "app"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.lambda.json
}

resource "aws_lambda_function" "api" {
  function_name    = local.lambda_name
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = "src/lambda.handler"
  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256
  memory_size      = 256
  timeout          = 10

  environment {
    variables = {
      NOMINATIONS_TABLE = aws_dynamodb_table.data["nominations"].name
      SIGNUPS_TABLE     = aws_dynamodb_table.data["signups"].name
      SUMMARIES_TABLE   = aws_dynamodb_table.data["summaries"].name
      ADMIN_PASSWORD    = var.admin_password
      ORIGIN_SECRET     = random_password.origin_secret.result
    }
  }

  depends_on = [aws_cloudwatch_log_group.lambda, aws_iam_role_policy.lambda]
}

resource "aws_apigatewayv2_api" "api" {
  name          = "${var.project_name}-api"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "default" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.api.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_rate_limit  = var.api_throttle_rate
    throttling_burst_limit = var.api_throttle_burst
  }
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}

# ---------------------------------------------------------------------------
# Static site: S3 (private) behind CloudFront
# ---------------------------------------------------------------------------

resource "aws_s3_bucket" "site" {
  bucket_prefix = "${var.project_name}-site-"
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket                  = aws_s3_bucket.site.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "site" {
  bucket = aws_s3_bucket.site.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_object" "site" {
  for_each = local.site_files

  bucket        = aws_s3_bucket.site.id
  key           = each.value
  source        = "${local.dist}/${each.value}"
  etag          = filemd5("${local.dist}/${each.value}")
  content_type  = lookup(local.mime_types, lower(element(split(".", each.value), length(split(".", each.value)) - 1)), "application/octet-stream")
  cache_control = endswith(each.value, ".html") ? "public, max-age=0, must-revalidate" : "public, max-age=3600"

  depends_on = [terraform_data.require_build]
}

resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "${var.project_name}-site"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

data "aws_iam_policy_document" "site_bucket" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.site.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.site.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "site" {
  bucket     = aws_s3_bucket.site.id
  policy     = data.aws_iam_policy_document.site_bucket.json
  depends_on = [aws_s3_bucket_public_access_block.site]
}

# Redirects www to the bare domain and maps clean URLs (/nominate) to files (/nominate.html).
resource "aws_cloudfront_function" "rewrite" {
  name    = "${var.project_name}-rewrite"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = <<-EOT
    var CANONICAL_HOST = "${var.domain_name}";
    function handler(event) {
      var req = event.request;
      var uri = req.uri;
      var host = req.headers.host ? req.headers.host.value : "";
      if (CANONICAL_HOST && host === "www." + CANONICAL_HOST) {
        return {
          statusCode: 301,
          statusDescription: "Moved Permanently",
          headers: { location: { value: "https://" + CANONICAL_HOST + uri } }
        };
      }
      if (uri.endsWith("/")) {
        req.uri = uri + "index.html";
      } else if (uri.split("/").pop().indexOf(".") === -1) {
        req.uri = uri + ".html";
      }
      return req;
    }
  EOT
}

# Visitors can send their own X-Forwarded-For, so the API trusts only this header,
# which CloudFront overwrites with the real connecting IP.
resource "aws_cloudfront_function" "viewer_ip" {
  name    = "${var.project_name}-viewer-ip"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = <<-EOT
    function handler(event) {
      var req = event.request;
      req.headers["x-viewer-ip"] = { value: event.viewer.ip };
      return req;
    }
  EOT
}

data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_origin_request_policy" "all_viewer_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

data "aws_cloudfront_response_headers_policy" "security" {
  name = "Managed-SecurityHeadersPolicy"
}

resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = var.project_name
  default_root_object = "index.html"
  price_class         = var.cloudfront_price_class
  aliases             = local.hostnames

  origin {
    origin_id                = "site"
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  origin {
    origin_id   = "api"
    domain_name = replace(aws_apigatewayv2_api.api.api_endpoint, "https://", "")

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }

    custom_header {
      name  = "x-origin-verify"
      value = random_password.origin_secret.result
    }
  }

  default_cache_behavior {
    target_origin_id           = "site"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.optimized.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.rewrite.arn
    }
  }

  dynamic "ordered_cache_behavior" {
    for_each = ["/api/*", "/admin", "/admin/*"]
    content {
      path_pattern               = ordered_cache_behavior.value
      target_origin_id           = "api"
      viewer_protocol_policy     = "redirect-to-https"
      allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
      cached_methods             = ["GET", "HEAD"]
      compress                   = true
      cache_policy_id            = data.aws_cloudfront_cache_policy.disabled.id
      origin_request_policy_id   = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
      response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security.id

      function_association {
        event_type   = "viewer-request"
        function_arn = aws_cloudfront_function.viewer_ip.arn
      }
    }
  }

  # S3 returns 403 for missing objects when listing is not allowed.
  custom_error_response {
    error_code            = 403
    response_code         = 404
    response_page_path    = "/404.html"
    error_caching_min_ttl = 60
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = !local.use_domain
    acm_certificate_arn            = local.use_domain ? aws_acm_certificate_validation.site[0].certificate_arn : null
    ssl_support_method             = local.use_domain ? "sni-only" : null
    minimum_protocol_version       = local.use_domain ? "TLSv1.2_2021" : null
  }
}

# ---------------------------------------------------------------------------
# Optional custom domain
# ---------------------------------------------------------------------------

resource "aws_route53_zone" "site" {
  count = local.use_domain && var.create_route53_zone ? 1 : 0
  name  = var.domain_name
}

resource "aws_acm_certificate" "site" {
  count                     = local.use_domain ? 1 : 0
  provider                  = aws.us_east_1
  domain_name               = var.domain_name
  subject_alternative_names = var.include_www ? ["www.${var.domain_name}"] : []
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "cert_validation" {
  for_each = local.use_domain ? {
    for o in aws_acm_certificate.site[0].domain_validation_options : o.domain_name => o
  } : {}

  zone_id         = local.zone_id
  name            = each.value.resource_record_name
  type            = each.value.resource_record_type
  records         = [each.value.resource_record_value]
  ttl             = 300
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "site" {
  count                   = local.use_domain ? 1 : 0
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.site[0].arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

resource "aws_route53_record" "mx" {
  count   = local.use_domain && length(var.mx_records) > 0 ? 1 : 0
  zone_id = local.zone_id
  name    = var.domain_name
  type    = "MX"
  ttl     = 3600
  records = var.mx_records
}

resource "aws_route53_record" "txt" {
  count   = local.use_domain && length(var.txt_records) > 0 ? 1 : 0
  zone_id = local.zone_id
  name    = var.domain_name
  type    = "TXT"
  ttl     = 3600
  records = var.txt_records
}

resource "aws_route53_record" "dmarc" {
  count   = local.use_domain && var.dmarc_record != "" ? 1 : 0
  zone_id = local.zone_id
  name    = "_dmarc.${var.domain_name}"
  type    = "TXT"
  ttl     = 3600
  records = [var.dmarc_record]
}

resource "aws_route53_record" "site" {
  for_each = {
    for pair in setproduct(local.hostnames, ["A", "AAAA"]) : "${pair[0]}-${pair[1]}" => { name = pair[0], type = pair[1] }
  }

  zone_id = local.zone_id
  name    = each.value.name
  type    = each.value.type

  alias {
    name                   = aws_cloudfront_distribution.site.domain_name
    zone_id                = aws_cloudfront_distribution.site.hosted_zone_id
    evaluate_target_health = false
  }
}
