# Engineering standards

Rules for changing this repository. GitHub branch protection enforces the review and required-check settings; this page is the written agreement.

## Required checks

Pull requests and pushes to `main` run the `ci` workflow (status check name `ci`):

- `npm ci` (lockfile install, npm cache)
- `npm run lint` — ESLint errors fail the check. Existing warnings stay warnings.
- `npm run typecheck` — `tsc --noEmit`
- `npm run test` — `node --test tests/*.mjs`
- `npm run build` — production build with placeholder Clerk keys, not production secrets
- `npm audit --audit-level=high` — temporarily non-blocking. The remaining high and critical findings are `next@16.2.4` and the nested `postcss` and `sharp` copies, which npm only clears by installing a newer Next.js. That upgrade is a separate pull request. See the TODO in `.github/workflows/ci.yml`.

Node.js is pinned to 22 LTS (`engines` in `package.json` and `.nvmrc`).

## Review

- One approving review is required before merge.
- Do not push directly to `main`.
- The Code Reviewer agent reviews each pull request.
- Dylan signs off the preview deployment before merge.
- Keep pull requests small and focused on one change.
