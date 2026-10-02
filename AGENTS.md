# SenseAgri Dashboard agent rules

Read this file before changing the repository. These rules apply to every coding agent.

## Required context

Before editing application code, read:

1. `docs/PROJECT_STATE.md`
2. `docs/PRODUCT_INVARIANTS.md`
3. `docs/DATA_SOURCES.md`
4. The relevant file under `docs/devices/` or `docs/calculations/`

The platform data producer lives in `../senseagri-platform`. Its `CLAUDE.md`, device registry, and pipeline code are authoritative for infrastructure and produced schemas. Dashboard code is authoritative for current presentation behavior. If documentation and code conflict, report the conflict before changing behavior.

## Scope and safety

- Treat existing user-visible behavior as intentional until the task says otherwise.
- Do not turn exploratory discussion, a backtest, or a provisional number into production behavior without explicit approval.
- Never invent a device constant, calibration, threshold, physical dimension, or missing-data rule. Record unknowns as unknown.
- Keep confirmed facts, provisional assumptions, and proposed behavior visibly separate.
- Do not modify unrelated files or clean up changes you did not create.
- Do not commit, push, merge, deploy, or modify production data unless the user has authorized that action.
- Work on a feature branch or worktree. Do not implement features directly on `main`.
- If the user says stop, stop all edits and commands immediately.

Before a non-trivial change, state the requested behavior, invariants that must remain true, files likely to change, and assumptions still requiring validation.

## Data rules

- Preserve units from ingestion through display. Name units in variables, APIs, axes, and documentation.
- Distinguish a missing row, a null value, an unchanged cumulative counter, and a measured zero. They do not mean the same thing.
- Do not display an estimate as a measured value.
- Farm data must remain farm-scoped on the server. The client must not choose raw farm IDs or storage keys.
- Store/query timestamps in UTC and show farm-facing times in SAST unless a feature explicitly says otherwise.
- Use S3/Athena silver tables for deep history and InfluxDB for the recent hot path. See `docs/DATA_SOURCES.md`.

## UI and chart rules

- Preserve the meaning, unit, orientation, and time range of an existing chart unless the task explicitly changes them.
- Silo radar distance means sensor-to-feed distance: a larger distance means less feed. The existing history chart uses millimetres, not fill percentage.
- Verify the full affected page at a representative desktop size and a phone size. A successful build is not proof that the behavior or layout is correct.
- Compare before/after screenshots for visual changes. Check loading, empty, error, sparse-data, and realistic-data states.
- When a sequence of fixes creates new regressions, stop patching. Compare with the last known-good commit and restore the smallest possible surface.

## Verification

Review `git diff` before claiming completion. Run the smallest relevant checks, then the production build for changes that can affect it. Report:

- what changed and why;
- checks performed;
- anything not verified with real data;
- provisional values or open questions.

Update the relevant reference document whenever device interpretation, data lineage, a formula, or a product invariant changes.
