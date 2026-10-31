# Engineering standards

Rules for changing this repository. The `ci` workflow runs the checks below on every pull request and on every push to `main`. Merge gates are GitHub branch protection settings, which Dylan still has to turn on for `main`.

## Required checks

Status check name: `ci`.

- `npm ci` (lockfile install, npm cache)
- `npm run lint` — ESLint errors fail the check. Existing warnings stay warnings.
- `npm run typecheck` — `tsc --noEmit`
- `npm run test` — `node --test tests/*.mjs`
- `npm run build` — production build with placeholder Clerk keys, not production secrets
- `npm audit --audit-level=high` — temporarily non-blocking. The remaining high and critical findings are `next@16.2.4` and the nested `postcss` and `sharp` copies, which npm only clears by installing a newer Next.js. That upgrade is a separate pull request. See the TODO in `.github/workflows/ci.yml`.

Node.js is pinned to 22 LTS (`engines` in `package.json` and `.nvmrc`).

## Branch protection Dylan must enable

On `main`:

- Required status check: `ci`
- Required approvals: 1
- Do not allow force pushes

Leave "Require review from Code Owners" off. Agent pull requests are authored as Dylan, so a code-owner review rule would block all of them. `CODEOWNERS` still names an owner for `src/app/api`, `src/lib`, and `docs`.

## Review

- The Code Reviewer agent reviews each pull request.
- Dylan signs off the preview deployment before merge.
- Do not push directly to `main`.
- Keep pull requests small and focused on one change.
