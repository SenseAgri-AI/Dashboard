# Deploy the dashboard to AWS

Lambda + CloudFront in **af-south-1** (Cape Town), built with SST v3 and OpenNext.
GitHub Actions deploys only when someone runs the Deploy workflow by hand.
A merge to `main` runs CI and does not deploy. There is no static AWS access key.

Nothing in this repo has been deployed. Apply the steps below yourself.

## 1. One-time: GitHub OIDC and the deploy role

From a checkout, with admin credentials in this account, region **af-south-1**:

```bash
aws cloudformation deploy \
  --region af-south-1 \
  --stack-name senseagri-dashboard-github-deploy \
  --template-file infra/cloudformation/github-oidc-deploy-role.yaml \
  --capabilities CAPABILITY_NAMED_IAM
```

The template creates the GitHub OIDC provider and a role named
`senseagri-dashboard-github-deploy`. The role can be assumed only when all of
these are true:

- repository `SenseAgri-AI/Dashboard`
- GitHub Environment `production`
- ref `refs/heads/main`

If the account already has a GitHub OIDC provider (the platform stack likely
does; an account can only have one per URL), reuse it:

```bash
aws iam list-open-id-connect-providers

aws cloudformation deploy \
  --region af-south-1 \
  --stack-name senseagri-dashboard-github-deploy \
  --template-file infra/cloudformation/github-oidc-deploy-role.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    CreateOidcProvider=false \
    ExistingOidcProviderArn=arn:aws:iam::ACCOUNT:oidc-provider/token.actions.githubusercontent.com
```

Copy the `DeployRoleArn` output.

In GitHub, on `SenseAgri-AI/Dashboard`:

1. Settings → Environments → create **production**.
   - Limit deployment branches to `main`.
   - Enable required reviewers and add at least one person before any deploy.
     The Deploy workflow uses `environment: production`. GitHub runs that job
     with no approval when the environment has no required reviewers. Section 4
     is the same gate, in deploy order.
2. Settings → Secrets and variables → Actions → Variables → add repository variable
   `AWS_DEPLOY_ROLE_ARN` = that role ARN. It is a variable, not a secret.

The same stack creates the managed policy
`senseagri-dashboard-permissions-boundary`. Apply this stack before
`sst deploy`. SST attaches that policy as the permissions boundary on every
Lambda role it creates (`$transform` in `sst.config.ts`, and again on each
function's role). The deploy role can create or change a role only when all
of these are true:

- The role name starts with `senseagri-dashboard-`. `sst.config.ts` pins the
  function and role names to `senseagri-dashboard-<stage>-…`. SST's own
  generated names are truncated and would be rejected.
- The role's permissions boundary is that policy (`iam:PermissionsBoundary`
  on `CreateRole`, `PutRolePolicy`, `DeleteRolePolicy`, `AttachRolePolicy`,
  `DetachRolePolicy`, and `PutRolePermissionsBoundary`).
- The only managed policy it can attach is `AWSLambdaBasicExecutionRole`
  (`iam:PolicyARN`).
- `iam:PassRole` is that same name prefix, and only to `lambda.amazonaws.com`.

The deploy role's own name matches the prefix. An explicit deny stops it
editing itself or the boundary policy. It also cannot mint IAM user access
keys. It is denied `s3` on the farm buckets (`senseagri-dev-silver`,
`senseagri-dev-raw`, `senseagri-dev-media-inference`,
`senseagri-dev-athena-results`, `senseagri-dev-gold`, and
`senseagri-dev-tfstate-*`), `dynamodb` on the push and alerts tables, and
`ssm` on `/senseagri/*`.

Lambda, S3, CloudWatch Logs, SQS, and DynamoDB are limited to names starting
with `senseagri-dashboard-` (plus the SST bootstrap buckets `sst-state-*` and
`sst-asset-*`). `iam:UpdateAssumeRolePolicy` is not granted: SST sets the
trust policy to `lambda.amazonaws.com` in `CreateRole`, and IAM cannot
constrain a later replacement principal.

CloudFront distributions are created with `CreateDistributionWithTags`.
Pulumi AWS 6.66.2, which SST 3.19.3 vendors, puts the provider default tags
in that call. `sst:app` is the app name `senseagri-dashboard`. It does not
call `TagResource` afterwards to attach the first tags. `TagResource` and
`UntagResource` are allowed only when the distribution already has that
tag. There is no exception for a missing tag. A `RequestTag`-only allow on
`*` would let this role tag any untagged distribution and then update or
delete it. AWS also lists `TagResource` as a permission of
`CreateDistributionWithTags`, checked on the new distribution before
`aws:ResourceTag` exists. That check is not granted. The first deploy is the
bootstrap in section 4. Do not loosen `TagResource` to make the check pass.

This provider does not tag CloudFront functions or key-value stores. Its
`CreateFunction` call has no tags field, and the key-value store resource
model has no tags attribute, so a request-tag condition would reject both
creates. `sst.config.ts` pins function names to
`senseagri-dashboard-<stage>-…`. Publish, update, and delete use that
prefix. AWS does support `aws:ResourceTag` on those function calls, and on
`UpdateKeyValueStore` and `DeleteKeyValueStore`, but the resources never
receive `sst:app`, so a tag condition would deny them. The key-value store
ARN is `key-value-store/<id>`, and AWS assigns that id.

These deploy allows stay on `*`. Everything else is a resource ARN, a name
prefix, or a tag condition.

| Action | Why it stays on `*` |
|---|---|
| `s3:ListAllMyBuckets` | No bucket resource. |
| `lambda:ListFunctions` | No resource. |
| `lambda:GetAccountSettings` | No resource. |
| `lambda:ListEventSourceMappings` | No resource. Get, delete, and update use `event-source-mapping/*` plus `lambda:FunctionArn` on `function:senseagri-dashboard-*`. |
| `lambda:CreateEventSourceMapping` | No mapping ARN yet. `lambda:FunctionArn` must be `function:senseagri-dashboard-*`. |
| `cloudfront:Get*` | Read. Distribution, cache-policy, function, key-value store, and origin-access-control IDs are assigned by AWS. |
| `cloudfront:List*` | List APIs have no resource, or the ID is assigned by AWS. Includes `ListTagsForResource`. |
| `cloudfront:Describe*` | Read. `DescribeFunction` and `DescribeKeyValueStore`. Same ID limitation. |
| `cloudfront:CreateDistribution` | No distribution ARN yet. `aws:RequestTag/sst:app` must be `senseagri-dashboard`. `TagResource` is not included. |
| `cloudfront:CreateFunction` | No resource type. This provider does not send tags, so a request-tag condition would reject the create. Later calls are `function/senseagri-dashboard-*`. |
| `cloudfront:CreateKeyValueStore` | No resource type. This provider does not send tags. |
| `cloudfront:CreateCachePolicy` | No resource type, and cache policies do not support tag conditions. |
| `cloudfront:CreateOriginAccessControl` | No resource type. SST does not send tags. |
| `logs:DescribeLogGroups` | Account-level describe. Create and write are limited to `/aws/lambda/senseagri-dashboard-*`. |
| `sqs:ListQueues` | No resource. Create and update are limited to `senseagri-dashboard-*`. |
| `dynamodb:ListTables` | No resource. Create and update are limited to `table/senseagri-dashboard-*`. |
| `acm:DescribeCertificate`, `acm:GetCertificate`, `acm:ListCertificates` | Read-only. Certificate ARNs are not a name prefix. This role cannot request or delete a certificate. |

These are not `*`, and they also cannot be limited to a name prefix or a tag:

| Action | Resource | Why it stays this wide |
|---|---|---|
| `cloudfront:UpdateCachePolicy`, `cloudfront:DeleteCachePolicy` | `cache-policy/*` | No tag condition. The ARN is `cache-policy/<id>` and AWS assigns the id. The policy name is not in the ARN. |
| `cloudfront:DeleteOriginAccessControl` | `origin-access-control/*` | No tag condition. SST does not send tags. The ARN id is assigned by AWS. The Name field is not in the ARN. |
| `cloudfront:UpdateKeyValueStore`, `cloudfront:DeleteKeyValueStore` | `key-value-store/*` | AWS supports `aws:ResourceTag` here, but this provider never tags the store, so requiring `sst:app` would deny the call. The ARN is `key-value-store/<id>`, not the name SST sets. |
| `cloudfront-keyvaluestore:DescribeKeyValueStore`, `ListKeys`, `UpdateKeys` | `key-value-store/*` | Data-plane API. No tag condition. Same store id, not the name. |

The boundary is the ceiling for the Lambda roles, not the deploy role. It
allows the farm calls in the table at the bottom of this file, the OpenNext
cache bucket, the revalidation queue, and the revalidation table. It does not
allow IAM. Two of its actions stay on `*`: `kms:Decrypt` only when SSM in
af-south-1 calls KMS (the key id is not in this repo), and
`cloudfront:CreateInvalidation` (distribution IDs are assigned by AWS). The
server role's identity policy is still the tighter grant. The boundary also
covers the image optimizer, the ISR revalidator, and the revalidation seeder,
which have their own roles.

## 2. Set secrets

SST secrets are encrypted in SSM under `/sst/`. They are not committed and are
not written into the browser bundle, except the two `NEXT_PUBLIC_` values,
which Next inlines on purpose because they are public.

Use the **same** Clerk and VAPID values as Vercel. New VAPID keys make every
phone subscribe again.

With admin credentials (this writes SSM; the GitHub role is only for Actions):

```bash
export AWS_REGION=af-south-1
npx sst secret set ClerkPublishableKey 'pk_live_...' --stage production
npx sst secret set ClerkSecretKey 'sk_live_...' --stage production
npx sst secret set VapidPublicKey '...' --stage production
npx sst secret set VapidPrivateKey '...' --stage production
npx sst secret set VapidSubject 'mailto:you@example.com' --stage production
```

Influx, Google, and Anthropic keys stay where they are. Do not copy them into
SST:

| SSM parameter | Used for |
|---|---|
| `/senseagri/dev/influxdb/token` | InfluxDB token |
| `/senseagri/dev/google/service-account` | Sheets (logs, events, size weights) |
| `/senseagri/dev/anthropic/api-key` | Assistant. Missing key returns 503 |
| `/senseagri/farms/<org-slug>/config` | Farm config. Admin UI can overwrite it |

## 3. Environment variables

| Variable | Production | Secret? |
|---|---|---|
| `AWS_REGION` | Set by Lambda to `af-south-1`. Not set in SST (it is reserved). Code also defaults to `af-south-1`. | No |
| `AWS_ACCESS_KEY_ID` | **Unset.** A static key would hide the Lambda role. | Must not be set |
| `AWS_SECRET_ACCESS_KEY` | **Unset.** | Must not be set |
| `AWS_SESSION_TOKEN` | Lambda sets this for the role session. | Must not be set by us |
| `INFLUXDB_URL` | SST env, `https://us-east-1-1.aws.cloud2.influxdata.com` | No |
| `INFLUXDB_BUCKET` | SST env, `senseagri-telemetry` | No |
| `INFLUXDB_ORG` | Not read by the app. | No |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | SST secret `ClerkPublishableKey`. Next inlines it into the browser bundle. | Public by design |
| `CLERK_SECRET_KEY` | SST secret `ClerkSecretKey`. Server only. | Yes |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | SST env, `/sign-in` | No |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | SST secret `VapidPublicKey`. Inlined into the browser bundle. | Public by design |
| `VAPID_PRIVATE_KEY` | SST secret `VapidPrivateKey`. Server only. | Yes |
| `VAPID_SUBJECT` | SST secret `VapidSubject`. | Contact address, treat as secret |
| `PUSH_TABLE` | SST env, `senseagri-dev-push-subscriptions` | No |
| `ALERTS_TABLE` | SST env, `senseagri-dev-alerts` | No |
| `ALERTS_REQUIRE_SHARED` | Unset, so the current legacy-alert fallback stays. Set `true` only when every farm has a notifier heartbeat. | No |
| `NODE_ENV` | `production` on Lambda. | No |

Local `.env.local` still needs the Clerk keys. Local AWS calls use `~/.aws`, not a key in the file.

## 4. First deploy

### Required reviewers, before any deploy

GitHub → `SenseAgri-AI/Dashboard` → Settings → Environments → **production**.

Enable required reviewers and add at least one person. Limit deployment
branches to `main`.

Do this before the bootstrap below and before every GitHub deploy. The Deploy
workflow uses `environment: production`. With required reviewers set, GitHub
pauses the job until one of them approves it. With none set, GitHub runs the
job as soon as the workflow starts.

### One-time bootstrap: the CloudFront distribution

`CreateDistributionWithTags` also checks `cloudfront:TagResource` on the
distribution being created. The OIDC role allows `TagResource` and
`UntagResource` only when that distribution already has
`aws:ResourceTag/sst:app` = `senseagri-dashboard`. A new distribution has no
tag, so the condition cannot match. The first `sst deploy` run as the OIDC
role will likely return AccessDenied on `cloudfront:TagResource`.

Do not loosen `TagResource`. Do not grant it on `*` with only
`aws:RequestTag`. That would let the role tag any untagged CloudFront
distribution and then update or delete it.

Create the distribution once with a principal that may tag a new resource.
Later deploys use the OIDC role.

1. An admin runs the first deploy with short-lived credentials, for example
   IAM Identity Center (SSO). Use a checkout of `main`, the same account, region
   `af-south-1`, and stage `production`. Do not use a long-lived access key,
   and do not use the GitHub OIDC role for this run. Sections 1 and 2 are
   already done, so the permissions boundary and the SST secrets exist.

   ```bash
   export AWS_REGION=af-south-1
   npx sst deploy --stage production
   ```

   SST writes the `production` state from this run. Later GitHub deploys
   update that same state.

2. Or an admin creates the distribution manually and tags it
   `sst:app=senseagri-dashboard`, then adopts it into that same `production`
   SST state. A distribution that exists only in the console is not the one
   SST updates. SST would still call `CreateDistributionWithTags` for its own
   resource, and the OIDC role would fail the same `TagResource` check.

After the distribution has `sst:app=senseagri-dashboard`, GitHub Actions and
the OIDC role are how every later deploy runs. That role can update and delete
that distribution. It still cannot tag a distribution that has no `sst:app` tag.

### Later deploys

Merge to `main` first. That runs CI only.

Then Actions → **Deploy** → **Run workflow**, with the branch set to `main`.
GitHub pauses the job until a required reviewer of **production** approves it.
After approval, the job assumes the deploy role and runs
`npx sst deploy --stage production`.

A run started from any branch other than `main` is skipped. The deploy role
would reject it anyway: it trusts only `refs/heads/main` in the production
environment.

The job runs on `ubuntu-24.04-arm` so `ffmpeg-static` installs its linux-arm64
binary. The server Lambda is arm64, 1536 MB, 60 second timeout, with Lambda
response streaming turned on.

SST prints a `*.cloudfront.net` URL. That is the site. The server function's
role is created by SST, carries the permissions boundary, and can only call
the resources listed in `sst.config.ts` plus the cache bucket, revalidation
queue, revalidation table, and CloudFront invalidation that OpenNext adds.

If the workflow fails because a secret is missing, set the secret and run the
Deploy workflow again. That asks for approval again.

## 5. Test on the CloudFront URL

Open the CloudFront URL. Sign in. Check one farm page that reads Influx, one
that reads Athena (analytics history), push if you use it, and an egg clip
(that route runs ffmpeg and is allowed 60 seconds). The assistant returns JSON
today; streaming is enabled so a later streaming response is not buffered by
the Lambda URL.

The URL is not the production domain yet. Vercel is still serving the real
hostname.

## 6. Clerk

In the Clerk dashboard for this instance, add the CloudFront hostname as an
allowed origin. When you attach the real hostname, add that too. Sign-in stays
at `/sign-in`. Keep the same Clerk instance so existing users and orgs still
resolve to `/senseagri/farms/<slug>/config`.

## 7. DNS cutover, and rolling back to Vercel

The hostname is not in this repo, so it is not wired in `sst.config.ts`.

1. Lower the DNS TTL.
2. In **us-east-1**, request an ACM certificate for the hostname and validate
   it. CloudFront only accepts us-east-1 certificates.
3. Point SST at it without taking over DNS, merge that change, then run the
   Deploy workflow on `main` again (a reviewer must approve):

   ```ts
   domain: {
     name: "dashboard.example.com",
     dns: false,
     cert: "arn:aws:acm:us-east-1:ACCOUNT:certificate/...",
   },
   ```

4. Set the DNS record at your DNS host to the CloudFront distribution. Leave
   the Vercel project and its environment in place.
5. Sign in on the real hostname and repeat the checks from step 5.

Rollback is the DNS record. Point it back at Vercel. Do not delete the Vercel
project, and do not remove its AWS key, until you are sure you will not roll
back.

## 8. Revoke the old IAM user key

Do this only after the new site is the one you intend to keep. Vercel rollback
stops working the moment this key is gone.

1. Remove `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` from Vercel.
2. Deactivate, then delete, the active access key on IAM user `dashboard-app`
   (the key id is recorded in `SECURITY_FOLLOWUPS.md`).
3. Remove `dashboard-app` from the `admins` group.
4. Delete the user once you have confirmed nothing else assumes it.

## What the app role can do

SST attaches this identity policy to the **server** function. Image
optimization, the ISR revalidator, and the revalidation seeder get their own
roles. Those roles are capped by the same permissions boundary. Their grants
are the cache bucket, the revalidation queue, and the revalidation table,
all named under `senseagri-dashboard-`.

| Call | Resource |
|---|---|
| SSM read | `/senseagri/dev/*` (Influx token, Google service account, Anthropic key) |
| SSM read and write | `/senseagri/farms/*` (farm config) |
| KMS decrypt | Only when SSM in af-south-1 calls KMS |
| Athena | Workgroup `senseagri`, database `senseagri_silver` |
| Glue read | `aligned_hourly`, `meters_hourly` |
| S3 read | `senseagri-dev-silver` |
| S3 read/write of query output | `senseagri-dev-athena-results` |
| S3 read | `senseagri-dev-media-inference` prefixes `clips/*` and `events/audio/*` |
| S3 read | `senseagri-dev-raw` prefix `raw/events/*` |
| DynamoDB put, delete, query | `senseagri-dev-push-subscriptions` |
| DynamoDB query | `senseagri-dev-alerts` |

`sizeWeightsService` and `eventService` only talk to Google Sheets. They use
the service account from `/senseagri/dev/google/service-account`. No extra AWS
resource. `alerts.ts` does not call AWS. The alerts route is what reads the
alerts table and, for a night-disturbance clip, the raw events prefix.

## If the first deploy complains

- **AccessDenied on `cloudfront:TagResource` while creating the distribution** — expected when the OIDC role runs the first `sst deploy`. Use the one-time bootstrap in section 4. Do not loosen `TagResource`.
- **OIDC provider already exists** — redeploy the stack with `CreateOidcProvider=false`.
- **Athena `AccessDenied` on GetQueryExecution** — the workgroup resource scope may be too tight for that API. Say so before widening it to `*`.
- **SSM decrypt fails** — the SecureString is probably a customer-managed key whose key policy does not trust the new role. `kms:Decrypt` in `sst.config.ts` is limited to calls that come from SSM.
- **Clip transcode runs out of memory or disk** — raise `server.memory` or Lambda ephemeral storage. 1536 MB and the default 512 MB `/tmp` are the starting point.
- **Results bucket name** — the app does not set an Athena output location. The workgroup `senseagri` must write to `senseagri-dev-athena-results`, which is the name in `SILVER_LAYER_SPEC.md`.
