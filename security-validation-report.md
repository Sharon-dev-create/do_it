# Do-It Security Validation Report

**Validation date:** 2026-10-14 (Africa/Lagos)
**Verdict:** **BLOCKED** for migration release until disposable-database integration checks are run. Source checks and available tests passed, but they do not establish PostgreSQL grants, rollback, or concurrency behavior. No migration was applied and no production service was modified.

## Scope and safety

Reviewed the creator archive/delete/batch migration and its API callers, V1/V2 submission routes, V2 archival receipt verification, the checked-in Arc V2 contract ABI/source, and the refund log scanner. Arc access used only read-only JSON-RPC methods. No transaction was signed or sent. No secrets were printed. No database, deployment, or production data access was performed.

The migration file was unchanged. The existing migration directory is ordered through `20261014000100_worker_auth_challenges.sql`, followed by `20261015000100_creator_task_archive_and_delete.sql`. The latter is dated October 15, one day after this validation date. Its position after the October 14 migration is chronologically consistent, but the future date/release intent should be confirmed before application. The application calls `create_creator_task_batch(uuid,text,text,jsonb)`; any rollout checklist referring to `create_creator_tasks` should be corrected.

## Checks actually run

- `node --experimental-transform-types --no-warnings --test lib/*.test.mjs` — **37 passed, 0 failed**. Includes source-level migration checks, CSV/auth/submission tests, and the new receipt/scanner tests. These are Node tests, not SQL integration tests.
- `forge test --match-path test/DoItEscrowV2.t.sol -vv` (from `contracts/`) — **27 passed, 0 failed**. Foundry printed a non-fatal cache warning because `/home/top-g/.foundry/cache/signatures` is read-only.
- `npm run lint` — **0 errors, 1 warning**: `contracts/lib/openzeppelin-contracts/eslint.config.mjs:10`, existing `import/no-anonymous-default-export` in vendored OpenZeppelin configuration.
- `npx tsc --noEmit` — **exit 0** after correcting type narrowing in the new receipt verifier. The first run before that correction failed on `parsed.args`; the issue was corrected, and the subsequent standalone check passed (the chained production build began only after it succeeded).
- `npm run build` — **exit 0**. Next.js warned that it chose `/home/top-g/package-lock.json` as workspace root while `/home/top-g/do-it/package-lock.json` also exists. It also logged a prerender fetch warning at `/api/gateway/balance`; static generation completed (27/27 pages) and the build exited successfully.
- `git diff --check` — **exit 0**.

The Node/npm launcher is a Snap shim and refused to run inside the sandbox because AppArmor was unavailable. The relevant local commands were rerun with escalation and existing dependencies only; no installs or services were started.

## Database and migration verification: not run

At validation time, `psql`, `pg_isready`, `postgres`, `initdb`, Docker, and Supabase CLI were unavailable, and no local PostgreSQL/Supabase process was found. `.env.local` and Supabase local metadata exist, but neither proves a safe isolated database is running. No remote Supabase endpoint was contacted. Therefore none of the following is verified against PostgreSQL:

- Whether obsolete overloads exist in an actual database, whether the migration removes them, or effective `has_function_privilege` results for `anon`, `authenticated`, and `service_role`.
- Actual function ownership, schema state/grants before and after the migration, SQL syntax/runtime behavior, transaction rollback, or migration rerun behavior.
- Concurrent batch replay and incomplete-batch replay, creator ownership enforcement, V1 submit/delete races, V2 archival restrictions, bulk deletion rollback, or foreign-key interactions.
- Whether Supabase applies this migration transactionally in the intended deployment path.

Static migration review confirms that the file drops the old `delete_creator_tasks(uuid[],text)` and `delete_creator_task(uuid,text)` signatures; defines the replacement signatures with the extra V2-state arguments; sets `search_path = pg_catalog, public`; revokes execution from `public`, `anon`, and `authenticated`; and grants execution to `service_role`. The application RPC argument names/types match these new functions. This is source evidence only, not proof of live privileges.

### Safe database verification still required

Provision a disposable local Supabase/PostgreSQL environment and positively verify it is local before any reset. Once Docker/Supabase tooling is available, use `docker info`, `npx supabase start`, verify the reported local API/DB endpoints, then `npx supabase db reset --local`. Against that disposable DB, capture pre/post catalogs and test function privileges as the relevant roles. Exercise transaction rollback, task ownership, batch replay with missing rows, concurrent replay, bulk-delete error rollback, V1 submission/deletion races, V2 state 3/4 restrictions, and submission/payment foreign keys. Do not substitute a linked/remote project for `--local`.

## Arc Testnet read-only evidence

The configured public fallback RPC returned chain ID `5042002` (Arc Testnet). The escrow address checked was `0x024539183A57428C63B2F2628b881105213332E4`. The checked-in V2 contract defines task states Created=0, Funded=1, Claimed=2, Completed=3, Refunded=4. This enum was verified in repository source/ABI; the deployed bytecode/source was not independently attested through an explorer.

A sequential `eth_getLogs` scan covered the complete inclusive range `66,340,107–66,997,117` (deployment block through the latest block observed in that run). It used 66 successful 10,000-block-or-smaller windows, completed without gaps or RPC errors, and found 7 `TaskCreated`, 6 `TaskFunded`, 1 `RewardCredited`, and 0 `TaskRefunded` logs. A 25,000-block request had first failed with `requested range too large`; a 10,000-block range succeeded. The scan was paced at about one request per second and took 82.421 seconds. A burst probe later received `rate limit exceeded`; that is an observed response, not a measured universal rate threshold.

Genuine successful receipts were fetched read-only and decoded against the checked-in ABI:

| Evidence | Transaction | Block | Result |
|---|---|---:|---|
| `TaskCreated` | `0x749551f0c5d0735d9994251c8a3d9cc1a9faf6ff70510711eb4d2d9a830c5de1` | 66,414,004 | Receipt status success; destination is configured escrow; event log index 8; task 0, creator `0x87E7048D1F27fc6dF2eC52a56e532d0d7F371Bbf`, reward 10,000 base units. |
| `TaskFunded` | `0x8ddd5a01d135f980ae1cb287663ad2d08cf65e1455d14ee3513ab3608a07e918` | 66,414,049 | Receipt status success; destination is configured escrow; event log index 19; task 0, same creator, amount 10,000 base units. |
| `RewardCredited` | `0xa96145873371002328532f6eeec628ebc6f20889a81aa467f021ca295642144c` | 66,921,626 | Receipt status success; destination is configured escrow; event log index 33; task 3, worker `0x4686a159487a97F8b2747485eF0653568aa6d521`, amount 100,000 base units. |

These are genuine on-chain records. Unit-test fixtures are separately sanitized: their hashes and wallet addresses are synthetic replacements, and they preserve event topics/data shape only. No matching refund receipt existed in the scanned range, so a positive refund receipt was not validated against a genuine refund transaction. The refund verifier's negative case is covered by a test proving that a `TaskFunded` log cannot satisfy `TaskRefunded` verification.

The current verifier checks receipt success, expected transaction hash, destination escrow, log emitter, decoded event name and arguments, receipt/log block agreement, and refund log index. It additionally checks task creator/reward allocation from create/fund receipts, reads current task state from the contract, and for Completed checks the confirmed payment's worker and matching `RewardCredited` receipt. Refund scanning propagates RPC errors to the fail-closed caller. The implementation does not claim finality beyond the current RPC receipt/state view; a reorg between independent reads or after a receipt is returned remains a chain/RPC risk.

## Refund scanner cost and limits

Current code uses a **10,000-block** inclusive window (`lib/v2-refund-log-scan.ts`), not 25,000. This is bounded and gap-free. Descending scan stops at the first verified match; each candidate event triggers a receipt lookup. The contract allows one terminal refund transition per task, so a valid task has at most one refund event, but the code does not impose a response-size cap on a malformed/misbehaving provider's returned event array.

Observed blocks 66,340,107 to 66,997,117 span 657,010 block intervals and 332,846 seconds, or about 0.5066 seconds per block. At this measured rate, 10,000-block-window projections are approximately:

| Scan age | Estimated blocks | `eth_getLogs` calls |
|---|---:|---:|
| 1 day | 170,547 | 18 |
| 30 days | 5,116,390 | 512 |
| 180 days | 30,698,340 | 3,070 |
| 365 days | 62,249,411 | 6,225 |

These are rate-based projections, not observed history; the escrow had only about 3.85 days of blocks in the scanned deployment range. The oldest actual task creation found was block 66,414,004, about 583,114 blocks behind the observed head, or 59 windows.

For a no-refund task, the archive helper does chain ID + two receipts + a `tasks` read + latest block + N sequential log-range calls (5 fixed RPC operations plus N, ignoring transport retries). A found refund adds one receipt call. Bulk deletion accepts up to 100 IDs and the route performs verification serially per V2 task, with no shared scan/cache/job: 100 tasks at the oldest observed age could cause roughly 5,900 log calls; using the full deployment-to-head range, roughly 6,600. There are also up to about 500 fixed calls across 100 tasks, before a candidate receipt. Viem's `http()` default behavior in the installed version is retry count 3 and timeout 10 seconds, allowing up to four attempts for retryable RPC calls; the measured scan used direct paced requests and did not include retries. These costs can create long requests and rate-limit failures, which fail closed rather than authorizing deletion.

Recommended follow-up before broad use: share/cache a single bounded refund scan for bulk tasks, cap total RPC work per request, and/or move indexing to a persistent server-side index/job with reorg handling. Do not widen the block window without verifying the active provider's limits.

## Findings

### High — database authorization and concurrency are unverified

The SQL source is restrictive, but no isolated database was available. The release cannot claim the old overloads are actually gone, only `service_role` can execute the intended functions, rollback is atomic, or concurrent deletion/submission is safe. **Action:** run the disposable database test plan above and inspect effective grants/catalog signatures before applying this migration anywhere.

### High — no positive refund receipt evidence

The complete inspected Arc range contained no `TaskRefunded` event. Negative event-substitution tests pass, and receipt checks are strict, but the real positive refund path has no genuine transaction validation. **Action:** validate against a genuine refund receipt on a test chain/test escrow before relying on this path for archival decisions.

### Medium — bulk refund verification can be expensive

Current 10k ranges fit the observed RPC limit and failures do not advance a cursor, but a 100-task bulk delete can issue thousands of sequential `eth_getLogs` calls. **Action:** share indexing work and impose a request budget before high-volume use.

### Medium — migration timestamp is in the future at review time

The filename sorts after the October 14 migration and is dated October 15, 2026, while validation is October 14. **Action:** confirm the intended release date/order; do not rename it without checking deployed migration history.

### Low — deployment sequencing must be coordinated

The migration drops old two-argument delete RPCs. The new application calls the new signatures; old application code will not continue to call its prior signatures after the migration. **Action:** deploy in a coordinated order/maintenance window or use a separately reviewed compatibility rollout. Migration-before-app and app-before-migration each have a compatibility window risk.

## Working-tree changes

No migration, production data, contract, deployment configuration, environment variable, or application payment flow was changed. The working tree changes are limited to the V2 archival receipt-verification/scanner hardening, its regression tests/fixtures, and this report:

- `lib/v2-task-archive.ts` — delegates receipt checks and bounded refund scanning to testable helpers.
- `lib/v2-refund-log-scan.ts` — 10,000-block gap-free descending scanner.
- `lib/v2-archive-receipt-verification.ts` — reusable strict receipt/event identity and argument validation, including explicit decoded event-name checks.
- `lib/fixtures-v2-archive-receipts.mjs` — sanitized fixtures based on genuine create/fund/reward receipts.
- `lib/v2-archive-verification.test.mjs` — receipt and scanner regression tests.
- `lib/creator-task-migration.test.mjs` — source assertions for verifier/scanner behavior.
- `security-validation-report.md` — this evidence and verdict.

At final inspection, the source changes were present in `HEAD` commit `53c0548` (`reconfigurations`), with `origin/main` pointing to the same commit; the only uncommitted file was this report. I did not run a commit or push command and did not alter that commit. The initial inspected baseline was `eddf34f`, so the workspace HEAD changed during this validation; its origin was not established here.

## Follow-up: isolated database validation (2026-10-14)

### Git state and report preservation

Phase 1 rechecked the requested state before editing: `pwd` was `/home/top-g/do-it`; branch `main`; `HEAD` and `origin/main` both resolved to `53c0548eb9b736a7338d074370ccedca67b1bcbf`; `git log -5` showed `53c0548`, `eddf34f`, `c697a75`, `99362f2`, and `3c9521d`. `git status --short --branch` showed `main...origin/main` and only `?? security-validation-report.md`; `git diff`, `git diff --cached`, and `git status --porcelain=v1` showed no tracked or staged changes. The report is untracked. A pre-edit copy was saved at `/tmp/security-validation-report.before-isolated-db-validation-20261014.md`; no prior report contents were removed. The branch and HEAD still match the previous report; no history repair was attempted.

### Environment and database result

The availability check ran `command -v` for `psql`, `pg_isready`, `postgres`, `initdb`, `docker`, `podman`, and `supabase`; none resolved. The repository has `supabase/config.toml` configured for Postgres major version 17 and local ports 54321–54324, but configuration is not evidence that a disposable instance is running. The configured seed path `supabase/seed.sql` is absent. The README documents a Docker/Supabase local path; required executables/runtime are missing. No Supabase URL, database URL, credentials, or environment-file values were read or printed; no remote database was contacted and no database command was attempted.

**Database integration result: BLOCKED / not run.** There is no database version or live environment identity to report, no pre/post catalog snapshot, and no migration application or rerun result. In particular, no effective grants, function owners, `pg_proc` overload inventory, rollback, replay, foreign-key runtime behavior, or concurrency outcome has been established. Do not interpret source tests as those results.

To unblock, provide an environment with Docker/Podman and the Supabase CLI already installed according to project policy. Verify `docker info`; start the local stack with `npx supabase start`; positively verify `npx supabase status` reports the expected loopback local endpoints and project before running `npx supabase db reset --local`. Use only that explicitly local stack, synthetic rows, and `--local`; then capture before/after catalogs and exercise the test matrix from the request. No such commands were run in this validation.

### Schema dependencies and source-level migration review

The checked-in migration chain establishes `tasks`, `submissions`, and `task_payments` in `20261001000100_do_it.sql`; task/submission and task/payment FKs originally cascade on task deletion, while payment-to-submission is `ON DELETE SET NULL`. `20261001000200_make_task_payment_unique.sql` adds a unique payment per task. `20261010000100_v2_escrow_records.sql` adds V2 IDs/hashes, `contract_version` (`v1`/`v2`), `payment_mechanism` (`circle_gateway`/`v2_reward_credit`), and `processing` payment status. The October 13/14 migrations add withdrawal and worker-auth tables. `supabase/config.toml` enables migrations and names an absent seed file. This identifies the checked-in prerequisites but is not a reconstructed/running schema; Supabase-managed roles/publication/extensions and actual migration-runner transaction behavior remain unverified.

The migration has no explicit top-level `BEGIN`/`COMMIT`. PostgreSQL statement errors abort the surrounding transaction, and a PostgREST RPC normally executes as a database transaction, but that behavior, the migration runner's transaction boundary, and rollback of all preceding row operations have not been integration-tested here. The bulk delete deliberately returns per-task outcomes for ordinary eligibility failures, so those outcomes can be partial success. An unexpected SQL exception should abort its RPC statement transaction; confirm this with a forced mid-batch SQL exception and inspect every row in a disposable database.

Text inspection confirms four `SECURITY DEFINER` functions in the target migration: single delete, bulk delete, `create_creator_task_batch`, and `record_rejected_task_submission`. Each pins `search_path = pg_catalog, public`, uses schema-qualified application tables, revokes execution from `public`, `anon`, and `authenticated`, and grants the intended function execution to `service_role`. The source drops the two obsolete delete overloads. No catalog proves actual owners/effective grants or rules out unmanaged overloads. The user's requested `create_creator_tasks(uuid,text,text,jsonb)` name does not exist in the migration or caller: the implemented and invoked signature is `create_creator_task_batch(uuid,text,text,jsonb)`.

The server routes derive creator identity from the signed `doit_worker_session` cookie (`getCreatorWallet`), which verifies the server MAC and returns a lowercase address. Bulk creation computes a hash of the normalized JSON payload and calls `create_creator_task_batch`; database row creation is in the same function invocation. The database row lock on the batch plus `inserted_batch` distinction prevents a conflicting batch ID from being treated as new, and the source returns `incomplete_batch` when an existing batch is missing rows. Existing tasks are preserved on replay, including archived rows; deleting a created task leaves the batch record and makes a later replay incomplete rather than recreating the row. These are static conclusions, not concurrent database results.

### Application transaction and race review (source only)

Correct V1/V2 submissions conditionally update the task from `open` with `archived_at IS NULL` and check the returned row before continuing to insert a submission/payment or initiate payout/claim behavior. Incorrect answers call the rejected-submission RPC, whose SQL locks the task `FOR UPDATE` and checks archive/open/creator state before inserting. The delete function also selects the task `FOR UPDATE`; sorted IDs give bulk deletion a stable task lock order. These paths suggest task-row serialization, but separate Supabase REST calls are not one transaction, so later submission/payment failures can occur after reservation has committed.

One existing recovery condition to include in database tests: a V1 correct submission reserves the task as `completed`, then inserts submission and payment in separate requests. If submission/payment creation fails, the handler can leave a completed task without corresponding financial records (payment insert failure explicitly returns 500). V2 similarly persists `claimed` before later inserts; payment-row failure intentionally leaves the task reserved to avoid a second claim. These behaviors are not changed here and need explicit reconciliation/support expectations. No database race test was run for correct/incorrect submission versus deletion, two competing workers, two delete requests, or concurrent batch replay.

### Migration ordering

As of 2026-10-14, `20261015000100_creator_task_archive_and_delete.sql` remains later than `20261014000100_worker_auth_challenges.sql` and is dated the following day. This is internally ordered but future-dated at review time. No migration history/catalog is available to establish whether that date is intentional or whether a deployed database has already recorded a conflicting version. Confirm intended release date and migration history before applying; do not rename automatically.

### Tests and files changed in this follow-up

No regression command was repeated because the prior report records passing checks and this follow-up changed only this report. No source, SQL, test, environment, production, or contract file was changed. `git diff --check` passed for tracked changes (none); whitespace was checked in the untracked report and is clean. The database tests remain blocked for the exact missing dependencies above.

**Verdict remains BLOCKED.** Required release evidence still includes a disposable Postgres/Supabase instance, before/after catalog and grant snapshots, test execution as actual roles, rollback/atomicity tests, replay tests, and deterministic two-connection race tests. No human approval can make an unverified remote database safe; use a verified local disposable environment or provide an independently confirmed isolated test database before applying anything.

