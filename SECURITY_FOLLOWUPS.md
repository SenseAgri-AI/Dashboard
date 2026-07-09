# Security follow-ups

Open security items for the SenseAgri portal. Owned by the app/services team.

---

## 1. `dashboard-app` IAM user is over-privileged (AdministratorAccess) — HIGH

**Found:** 2026-07-08 · account `336814727818` (af-south-1)

The Vercel app authenticates to AWS as the IAM **user `dashboard-app`** (static
`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` in Vercel env; one active access key
`AKIAU425Y4KFFNAMSIFU`). That user is in the **`admins` group → `AdministratorAccess`**.

**Risk:** a Next.js app holding static keys with **full account admin**. If those env keys
leak (Vercel misconfig, log spill, repo, etc.) the **entire AWS account is compromised** —
delete buckets, exfiltrate secrets, spin up resources. Classic least-privilege violation.

**What the app actually uses (traced from `src/lib/*.ts`) — the whole footprint:**
| Action | Resource | Source |
|---|---|---|
| `ssm:GetParameter` | `/senseagri/dev/influxdb/token`, `/senseagri/dev/google/service-account` | `influxdb.ts`, `sheets.ts` |
| `ssm:GetParameter`, `ssm:GetParametersByPath` | `/senseagri/farms/*` | `farms.ts` |
| `ssm:PutParameter` | `/senseagri/farms/*` (admin UI writes farm config) | `farms.ts` |
| Athena / Glue / S3 read | `senseagri-dev-silver` + `-athena-results` | `senseagri-dev-silver-app-read` (already attached) |

No DynamoDB, Lambda, EC2, IAM, or other S3. That's it.

**Current state:** the least-privilege read policy **`senseagri-dev-silver-app-read` is attached**
(done 2026-07-08). Admin has **not** been removed yet — so the read policy is currently redundant.

**Remediation (ready to apply; breaking-risk → verify on preview after):**
1. Create + attach a scoped SSM policy, e.g. `senseagri-dev-app-ssm`:
   ```jsonc
   { "Version": "2012-10-17", "Statement": [
     { "Sid": "SsmReadSecrets", "Effect": "Allow",
       "Action": ["ssm:GetParameter", "ssm:GetParametersByPath"],
       "Resource": [
         "arn:aws:ssm:af-south-1:336814727818:parameter/senseagri/dev/*",
         "arn:aws:ssm:af-south-1:336814727818:parameter/senseagri/farms/*" ] },
     { "Sid": "SsmWriteFarmConfig", "Effect": "Allow",
       "Action": ["ssm:PutParameter"],
       "Resource": ["arn:aws:ssm:af-south-1:336814727818:parameter/senseagri/farms/*"] },
     { "Sid": "KmsDecrypt", "Effect": "Allow", "Action": ["kms:Decrypt"],
       "Resource": "<the KMS key id for the SecureString params, or aws/ssm>" } ] }
   ```
   ⚠️ First check the SecureString params' `KeyId` (`aws ssm describe-parameters`). If they use a
   customer-managed key, the `kms:Decrypt` statement is required or the app can't read the token /
   Google key and will 500. If they use the default `aws/ssm` key, SSM handles decrypt.
2. **Remove `dashboard-app` from the `admins` group.**
3. Verify on the Vercel preview (`testing`) that dashboard, logs, schedule, and admin farm-config
   save all still work. Reversible: re-add to `admins` if anything breaks.

**Bonus hardening (later):** rotate the access key after scope-down; consider Vercel OIDC →
`sts:AssumeRole` instead of a long-lived static key.
