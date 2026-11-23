# Community Toy Drive

An open-source website for running a local Christmas toy drive. Families (or people who know them) can request toys, neighbors can sign up to donate or volunteer, and organizers get a private dashboard to manage everything.

Built by the Fool Throttle Foundation for the Soda Springs, Idaho toy drive with Stockman's Bar, and shared so other communities can run their own.

## Features

- **Toy request form**: parents can request for their own kids, or anyone can nominate a family. Collects each child's first name, age, gender, sizes and wish list.
- **Donor & volunteer sign-up**: sponsor a family, donate toys, wrap, or deliver.
- **Admin dashboard** at `/admin`: review requests and sign-ups, track status (new, contacted, approved, sponsored, delivered), keep private notes, search, and export to CSV.
- **Shopping list by age**: see how many kids you have in each age group, split by boys/girls, so you know what to buy.
- **Season summary**: save anonymous counts (families, children, ages, gifts, volunteer roles) before you delete the lists, so you can share how the year went and plan next year.
- **One config file** for your organization name, partners, towns, dates, drop-off spots, contact info and colors.
- **Privacy-minded**: submissions are only visible to admins, spam is filtered with a honeypot and rate limits, and data is encrypted at rest on AWS.
- **No dependencies** to run locally (just Node.js), and a ready-to-go **Terraform** deployment to AWS that costs pennies when idle.

## Quick start (local)

Requires [Node.js](https://nodejs.org) 22.13 or newer.

```bash
git clone <this repo>
cd <repo>
cp .env.example .env        # set ADMIN_PASSWORD
npm start
```

Open http://localhost:3000. The admin dashboard is at http://localhost:3000/admin (username `admin`, password from `.env`). Local data is stored in `data/toydrive.db` (SQLite).

Use `npm run dev` to auto-restart when you edit files.

## Make it yours

1. **Edit `site.config.json`.** This controls nearly everything visitors see:

   | Field | What it's for |
   | --- | --- |
   | `siteName`, `shortName`, `location`, `year`, `description` | Titles, header and search-engine description |
   | `hero` | Homepage headline and intro paragraph |
   | `organization` | Your nonprofit's name, link, description, and optional `taxNote` (shown on the donate page; leave it empty if you don't need one) |
   | `partners` | Businesses or groups you're working with (can be empty) |
   | `dates` | Request deadline, donation deadline, delivery day |
   | `contact` | Email, phone, optional Facebook link |
   | `serviceArea`, `towns` | Area you serve, and the towns in it |
   | `dropOffLocations` | Where people can drop off toys |
   | `theme` | Brand colors |

2. **Edit page copy** (optional) in `templates/`. Pages use simple `{{placeholders}}` filled from the config. Shared header/footer live in `templates/partials/`.
3. **Edit styles** (optional) in `public/styles.css`.

Run `npm run build` to render the site into `dist/`, or just `npm start`, which builds automatically.

## Deploy to AWS

The `infra/` folder contains Terraform that creates:

- **CloudFront** serving the site over HTTPS (optionally on your own domain)
- A private **S3** bucket holding the built pages
- **API Gateway (HTTP API) + Lambda** handling form submissions and the admin dashboard
- **DynamoDB** tables for requests, sign-ups, and anonymous season summaries, with point-in-time backups and deletion protection

For a small community drive, this typically falls within the AWS free tier or costs well under a few dollars a month. There are no servers to patch.

### Prerequisites

- An AWS account
- [Terraform](https://developer.hashicorp.com/terraform/install) 1.6+
- [AWS CLI](https://aws.amazon.com/cli/) signed in (`aws login` or `aws configure`)

### Steps

```bash
cp infra/terraform.tfvars.example infra/terraform.tfvars
# edit infra/terraform.tfvars: set project_name and a strong admin_password

terraform -chdir=infra init
npm run deploy      # builds the site, then runs terraform apply
```

When it finishes, Terraform prints `site_url` and `admin_url`.

### Custom domain

Set `domain_name` in `terraform.tfvars`, then re-run `npm run deploy`. The certificate and DNS records are created for you.

- If the domain already has a Route 53 hosted zone, set `route53_zone_id` to that zone.
- If the domain is registered somewhere else, set `create_route53_zone = true`. After apply, point the registrar's nameservers at the `nameservers` output.

`include_www` defaults to true, so `www` redirects to the bare domain.

### Updating the site

Edit the config or templates and run `npm run deploy` again. HTML updates show up immediately. CSS/JS are cached for up to an hour; to force an update:

```bash
aws cloudfront create-invalidation --distribution-id "$(terraform -chdir=infra output -raw cloudfront_distribution_id)" --paths '/*'
```

### Terraform state

By default Terraform keeps state in `infra/terraform.tfstate` on your machine. That file contains your admin password, so don't commit it (it's git-ignored). For anything long-lived, configure the S3 backend in `infra/versions.tf`.

### Tearing down

DynamoDB tables have deletion protection so a stray `terraform destroy` can't wipe out families' requests or the anonymous season summaries. Export your data first, then disable protection in the AWS console (or set `deletion_protection_enabled = false` and apply), empty the S3 bucket, and run `terraform -chdir=infra destroy`.

## Privacy

This site collects names, phone numbers, addresses and children's information. Please:

- Use a long, unique admin password and share it only with coordinators.
- Delete or export-and-delete personal records after the season ends. In the admin dashboard, open **Season summary**, save the anonymous summary, then delete the lists. The summary keeps counts only and stays after the names, contact details, addresses, sizes, and wish lists are gone.
- Tell families how their information will be used. The default copy says it's only shared with volunteers coordinating gifts.

## Project layout

```
site.config.json     Your drive's details
templates/           Page templates (rendered into dist/)
public/              CSS and browser JS (copied into dist/)
private/             Admin dashboard (served only after login)
src/core.js          Validation, admin API, CSV export (shared by local + AWS)
src/store-*.js       SQLite (local) and DynamoDB (AWS) storage
src/lambda.js        AWS Lambda entry point
server.js            Local server
scripts/build.js     Static site builder
infra/               Terraform for AWS
```

## Contributing

Issues and pull requests are welcome, especially from other communities running drives. Please keep the project dependency-free at runtime and easy for non-developers to configure.

## License

[MIT](LICENSE)
