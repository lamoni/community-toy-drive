output "site_url" {
  description = "Public URL of the site."
  value       = local.use_domain ? "https://${var.domain_name}" : "https://${aws_cloudfront_distribution.site.domain_name}"
}

output "admin_url" {
  description = "Admin dashboard (username: admin)."
  value       = local.use_domain ? "https://${var.domain_name}/admin" : "https://${aws_cloudfront_distribution.site.domain_name}/admin"
}

output "cloudfront_distribution_id" {
  description = "Use to invalidate the cache: aws cloudfront create-invalidation --distribution-id <id> --paths '/*'"
  value       = aws_cloudfront_distribution.site.id
}

output "nameservers" {
  description = "When create_route53_zone is true, set these as the domain's nameservers at your registrar."
  value       = one(aws_route53_zone.site[*].name_servers)
}

output "dynamodb_tables" {
  description = "DynamoDB tables holding submissions and anonymous season summaries."
  value       = { for k, t in aws_dynamodb_table.data : k => t.name }
}
