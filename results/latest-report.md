# Run report — 2026-11-06T10:42:42.235Z

Target: disposable Supabase project `sgjsocdtrhztgdrllbcj` via the shared **Supavisor** pooler (real Supavisor, hosted).

| Path | Endpoint |
|---|---|
| App (test_app) · transaction pool :6543 | `aws-0-ap-southeast-1.pooler.supabase.com:6543 (transaction mode) as test_app.sgjsocdtrhztgdrllbcj` |
| Delivery (test_delivery) · transaction pool :6543 | `aws-0-ap-southeast-1.pooler.supabase.com:6543 (transaction mode) as test_delivery.sgjsocdtrhztgdrllbcj` |
| Delivery (test_delivery) · session pool :5432 | `aws-0-ap-southeast-1.pooler.supabase.com:5432 (session mode) as test_delivery.sgjsocdtrhztgdrllbcj` |
| Human read-only (test_readonly_human) · session pool :5432 | `aws-0-ap-southeast-1.pooler.supabase.com:5432 (session mode) as test_readonly_human.sgjsocdtrhztgdrllbcj` |
| Maintenance (test_maint) · session pool :5432 | `aws-0-ap-southeast-1.pooler.supabase.com:5432 (session mode) as test_maint.sgjsocdtrhztgdrllbcj` |

| Test | Verdict | Summary |
|---|---|---|
| Test 1 · Baseline | **PASS** | Every client authenticated as its intended role through Supavisor, and test_app can insert. |
| Experiment A · Same role, same transaction pool (incident reproduction) | **BLOCKED** | 20/20 application writes were rejected with 25006. Every rejected write ran on backend 13564, which Client A had set read-only. |
| Experiment B · Delivery uses its own role (and therefore its own pools) | **NOT BLOCKED** | All 30/30 app writes succeeded while Delivery's backends were read-only. App backends (13586) and Delivery backends (13592, 13591, 13584, 13585) never overlapped. |
| Experiment C · Same pool, but the script uses BEGIN READ ONLY / SET LOCAL | **NOT BLOCKED** | All 20/20 app writes succeeded on the same pool, including 20 on backend 13632 that the script had just used. |
| Test 4 · Permission checks | **PASS** | Every allowed action worked and every forbidden action was denied (42501). |

## Test 1 · Baseline — PASS

Every client authenticated as its intended role through Supavisor, and test_app can insert.


| Time (UTC) | Client | Login role | Mode | Backend PID | default_ro | Step | Result |
|---|---|---|---|---|---|---|---|
| 10:40:46.377 | Baseline test_app (transaction) | test_app | transaction | 13507 | off | Connected to aws-0-ap-southeast-1.pooler.supabase.com:6543 (transaction mode) as test_app.sgjsocdtrhztgdrllbcj | OK |
| 10:40:46.597 | Baseline test_app (transaction) | test_app | transaction | 13507 | off | write #baseline | OK |
| 10:40:47.664 | Baseline test_delivery (transaction) | test_delivery | transaction | 13497 | off | Connected to aws-0-ap-southeast-1.pooler.supabase.com:6543 (transaction mode) as test_delivery.sgjsocdtrhztgdrllbcj | OK |
| 10:40:47.664 | Baseline test_delivery (transaction) | test_delivery | transaction | 13497 | off | SELECT count(*) from pool_test.events | OK |
| 10:40:48.626 | Baseline test_delivery (session) | test_delivery | session | 13558 | off | Connected to aws-0-ap-southeast-1.pooler.supabase.com:5432 (session mode) as test_delivery.sgjsocdtrhztgdrllbcj | OK |
| 10:40:48.626 | Baseline test_delivery (session) | test_delivery | session | 13558 | off | SELECT count(*) from pool_test.events | OK |

**What this shows:** Login roles, endpoints and pool modes are as recorded. test_app has INSERT on pool_test.events.



## Experiment A · Same role, same transaction pool (incident reproduction) — BLOCKED

20/20 application writes were rejected with 25006. Every rejected write ran on backend 13564, which Client A had set read-only.

```json
{
  "poisonedPids": [
    13564
  ],
  "appPids": [
    13564
  ],
  "attempts": 20,
  "okWrites": 0,
  "rejectedWrites": 20,
  "writesOnPoisonedBackend": 20
}
```

| Time (UTC) | Client | Login role | Mode | Backend PID | default_ro | Step | Result |
|---|---|---|---|---|---|---|---|
| 10:40:57.635 | Admin (Management API) | postgres | admin |  |  | Recycle test_app backends — start from clean backends | OK |
| 10:40:58.582 | Client A (ad-hoc script, test_app) | test_app | transaction | 13564 | on | SET default_transaction_read_only = on (session level), COMMIT | SETTING APPLIED — Backend 13564 now has default_transaction_read_only=on for the rest of its life. |
| 10:41:01.950 | Admin (Management API) | postgres | admin |  |  | Server-side snapshot — Client A has disconnected; are its backends still alive? | INFO — 13564=test_app, 13497=test_delivery, 13558=test_delivery, 13520=test_maint, 13517=test_readonly_human (poisoned: 13564) |
| 10:41:02.678 | Client B (application, test_app) | test_app | transaction | 13564 | on | write #1 | ERROR 25006 — cannot execute INSERT in a read-only transaction |
| 10:41:03.096 | Client B (application, test_app) | test_app | transaction | 13564 | on | write #2 | ERROR 25006 — cannot execute INSERT in a read-only transaction |
| 10:41:03.514 | Client B (application, test_app) | test_app | transaction | 13564 | on | write #3 | ERROR 25006 — cannot execute INSERT in a read-only transaction |
| 10:41:03.934 | Client B (application, test_app) | test_app | transaction | 13564 | on | write #4 | ERROR 25006 — cannot execute INSERT in a read-only transaction |
| 10:41:04.423 | Client B (application, test_app) | test_app | transaction | 13564 | on | write #5 | ERROR 25006 — cannot execute INSERT in a read-only transaction |
| 10:41:04.836 | Client B (application, test_app) | test_app | transaction | 13564 | on | write #6 | ERROR 25006 — cannot execute INSERT in a read-only transaction |
| 10:41:05.316 | Client B (application, test_app) | test_app | transaction | 13564 | on | write #7 | ERROR 25006 — cannot execute INSERT in a read-only transaction |
| 10:41:05.737 | Client B (application, test_app) | test_app | transaction | 13564 | on | write #8 | ERROR 25006 — cannot execute INSERT in a read-only transaction |
| 10:41:06.242 | Client B (application, test_app) | test_app | transaction | 13564 | on | write #9 | ERROR 25006 — cannot execute INSERT in a read-only transaction |
| 10:41:06.654 | Client B (application, test_app) | test_app | transaction | 13564 | on | write #10 | ERROR 25006 — cannot execute INSERT in a read-only transaction |
| 10:41:07.537 | Client B (application, test_app) | test_app | transaction | 13564 | on | write #11 | ERROR 25006 — cannot execute INSERT in a read-only transaction |
| 10:41:07.959 | Client B (application, test_app) | test_app | transaction | 13564 | on | write #12 | ERROR 25006 — cannot execute INSERT in a read-only transaction |
| 10:41:08.448 | Client B (application, test_app) | test_app | transaction | 13564 | on | write #13 | ERROR 25006 — cannot execute INSERT in a read-only transaction |
| 10:41:08.858 | Client B (application, test_app) | test_app | transaction | 13564 | on | write #14 | ERROR 25006 — cannot execute INSERT in a read-only transaction |
| 10:41:09.322 | Client B (application, test_app) | test_app | transaction | 13564 | on | write #15 | ERROR 25006 — cannot execute INSERT in a read-only transaction |
| 10:41:09.709 | Client B (application, test_app) | test_app | transaction | 13564 | on | write #16 | ERROR 25006 — cannot execute INSERT in a read-only transaction |
| 10:41:10.091 | Client B (application, test_app) | test_app | transaction | 13564 | on | write #17 | ERROR 25006 — cannot execute INSERT in a read-only transaction |
| 10:41:10.587 | Client B (application, test_app) | test_app | transaction | 13564 | on | write #18 | ERROR 25006 — cannot execute INSERT in a read-only transaction |
| 10:41:10.983 | Client B (application, test_app) | test_app | transaction | 13564 | on | write #19 | ERROR 25006 — cannot execute INSERT in a read-only transaction |
| 10:41:11.487 | Client B (application, test_app) | test_app | transaction | 13564 | on | write #20 | ERROR 25006 — cannot execute INSERT in a read-only transaction |
| 10:41:20.641 | Admin (Management API) | postgres | admin |  |  | Recycle test_app backends — remove the poisoned backends | OK |
| 10:41:21.469 | Client B after recycle | test_app | transaction | 13576 | off | write #post-recycle | OK |

**What this shows:** A session-level SET committed by one client stays on the pooled Supavisor backend after that client disconnects. A different client using the same role and transaction pool can be given that backend and inherits the setting.

**Not shown by this test:** How often this happens under real production concurrency and pool size.

## Experiment B · Delivery uses its own role (and therefore its own pools) — NOT BLOCKED

All 30/30 app writes succeeded while Delivery's backends were read-only. App backends (13586) and Delivery backends (13592, 13591, 13584, 13585) never overlapped.

```json
{
  "deliveryPids": [
    13592,
    13591,
    13584,
    13585
  ],
  "appPids": [
    13586
  ],
  "overlap": [],
  "appBackendsServerRole": [
    "test_app"
  ],
  "attempts": 30,
  "okWrites": 30,
  "rejectedWrites": 0
}
```

| Time (UTC) | Client | Login role | Mode | Backend PID | default_ro | Step | Result |
|---|---|---|---|---|---|---|---|
| 10:41:31.446 | Admin (Management API) | postgres | admin |  |  | Recycle test_app, test_delivery backends — start from clean backends | OK |
| 10:41:32.514 | Delivery (test_delivery, tx pool) #1 | test_delivery | transaction | 13592 | on | SET default_transaction_read_only = on (session level), COMMIT | SETTING APPLIED — Backend 13592 now has default_transaction_read_only=on for the rest of its life. |
| 10:41:32.763 | Delivery (test_delivery, tx pool) #2 | test_delivery | transaction | 13591 | on | SET default_transaction_read_only = on (session level), COMMIT | SETTING APPLIED — Backend 13591 now has default_transaction_read_only=on for the rest of its life. |
| 10:41:32.763 | Delivery (test_delivery, tx pool) #3 | test_delivery | transaction | 13584 | on | SET default_transaction_read_only = on (session level), COMMIT | SETTING APPLIED — Backend 13584 now has default_transaction_read_only=on for the rest of its life. |
| 10:41:36.099 | Delivery (test_delivery, session pool) | test_delivery | session | 13585 | on | SET default_transaction_read_only = on (session level, held open) | SETTING APPLIED — Delivery's own session is now read-only (default_transaction_read_only=on). |
| 10:41:36.099 | Delivery (test_delivery, session pool) | test_delivery | session | 13585 | on | Delivery's own INSERT (expected to be rejected) | ERROR 25006 — cannot execute INSERT in a read-only transaction |
| 10:41:37.268 | App (test_app, tx pool) | test_app | transaction | 13586 | off | write #1 | OK |
| 10:41:37.894 | App (test_app, tx pool) | test_app | transaction | 13586 | off | write #2 | OK |
| 10:41:38.348 | App (test_app, tx pool) | test_app | transaction | 13586 | off | write #3 | OK |
| 10:41:38.974 | App (test_app, tx pool) | test_app | transaction | 13586 | off | write #4 | OK |
| 10:41:39.430 | App (test_app, tx pool) | test_app | transaction | 13586 | off | write #5 | OK |
| 10:41:39.951 | App (test_app, tx pool) | test_app | transaction | 13586 | off | write #6 | OK |
| 10:41:40.405 | App (test_app, tx pool) | test_app | transaction | 13586 | off | write #7 | OK |
| 10:41:41.163 | App (test_app, tx pool) | test_app | transaction | 13586 | off | write #8 | OK |
| 10:41:41.679 | App (test_app, tx pool) | test_app | transaction | 13586 | off | write #9 | OK |
| 10:41:42.225 | App (test_app, tx pool) | test_app | transaction | 13586 | off | write #10 | OK |
| 10:41:42.892 | App (test_app, tx pool) | test_app | transaction | 13586 | off | write #11 | OK |
| 10:41:43.354 | App (test_app, tx pool) | test_app | transaction | 13586 | off | write #12 | OK |
| 10:41:43.800 | App (test_app, tx pool) | test_app | transaction | 13586 | off | write #13 | OK |
| 10:41:44.299 | App (test_app, tx pool) | test_app | transaction | 13586 | off | write #14 | OK |
| 10:41:45.539 | App (test_app, tx pool) | test_app | transaction | 13586 | off | write #15 | OK |
| 10:41:49.926 | Admin (Management API) | postgres | admin |  |  | Server-side snapshot — while Delivery is read-only and the app is writing | INFO — 13586=test_app, 13584=test_delivery, 13585=test_delivery, 13591=test_delivery, 13592=test_delivery, 13520=test_maint |
| 10:41:50.229 | App (test_app, tx pool) | test_app | transaction | 13586 | off | write #16 | OK |
| 10:41:50.725 | App (test_app, tx pool) | test_app | transaction | 13586 | off | write #17 | OK |
| 10:41:51.276 | App (test_app, tx pool) | test_app | transaction | 13586 | off | write #18 | OK |
| 10:41:51.816 | App (test_app, tx pool) | test_app | transaction | 13586 | off | write #19 | OK |
| 10:41:52.335 | App (test_app, tx pool) | test_app | transaction | 13586 | off | write #20 | OK |
| 10:41:52.798 | App (test_app, tx pool) | test_app | transaction | 13586 | off | write #21 | OK |
| 10:41:53.375 | App (test_app, tx pool) | test_app | transaction | 13586 | off | write #22 | OK |
| 10:41:53.823 | App (test_app, tx pool) | test_app | transaction | 13586 | off | write #23 | OK |
| 10:41:54.423 | App (test_app, tx pool) | test_app | transaction | 13586 | off | write #24 | OK |
| 10:41:54.881 | App (test_app, tx pool) | test_app | transaction | 13586 | off | write #25 | OK |
| 10:41:55.355 | App (test_app, tx pool) | test_app | transaction | 13586 | off | write #26 | OK |
| 10:41:55.874 | App (test_app, tx pool) | test_app | transaction | 13586 | off | write #27 | OK |
| 10:41:56.544 | App (test_app, tx pool) | test_app | transaction | 13586 | off | write #28 | OK |
| 10:41:56.992 | App (test_app, tx pool) | test_app | transaction | 13586 | off | write #29 | OK |
| 10:41:57.568 | App (test_app, tx pool) | test_app | transaction | 13586 | off | write #30 | OK |
| 10:42:05.091 | Admin (Management API) | postgres | admin |  |  | Recycle test_app, test_delivery backends — tidy up | OK |

**What this shows:** Supavisor gave test_app and test_delivery disjoint server backends (no shared PID; server reports each PID under its own role). A Postgres backend is logged in as exactly one role for its whole life, so a test_delivery backend cannot be handed to a test_app client. 30 app writes in this run were unaffected by Delivery's session-level read-only setting on both Delivery paths.

**Not shown by this test:** That nothing else can make app connections read-only: ALTER ROLE test_app SET …, ALTER DATABASE … SET …, or Delivery using the app login would all bypass this separation. Behaviour on the direct connection (db.<ref>.supabase.co is IPv6-only and was not reachable here) and on the dedicated PgBouncer pooler. Future Supavisor versions or a different pool config (staging/production).

## Experiment C · Same pool, but the script uses BEGIN READ ONLY / SET LOCAL — NOT BLOCKED

All 20/20 app writes succeeded on the same pool, including 20 on backend 13632 that the script had just used.

```json
{
  "scriptPids": [
    13632
  ],
  "appPids": [
    13632
  ],
  "writesOnScriptBackend": 20,
  "rejectedWrites": 0
}
```

| Time (UTC) | Client | Login role | Mode | Backend PID | default_ro | Step | Result |
|---|---|---|---|---|---|---|---|
| 10:42:12.202 | Admin (Management API) | postgres | admin |  |  | Recycle test_app backends — start from clean backends | OK |
| 10:42:13.299 | Client A (script, test_app, BEGIN READ ONLY) | test_app | transaction | 13632 | off | BEGIN READ ONLY; INSERT (rejected as intended) | ERROR 25006 — transaction_read_only=on inside the transaction; default_transaction_read_only=off |
| 10:42:13.854 | Client A (script, test_app, BEGIN READ ONLY) | test_app | transaction | 13632 | on | BEGIN; SET LOCAL default_transaction_read_only = on; COMMIT | SETTING APPLIED (transaction only) — inside: default_transaction_read_only=on |
| 10:42:14.236 | Client A (script, test_app, BEGIN READ ONLY) | test_app | transaction | 13632 | off | Next transaction from the script | INFO — default_transaction_read_only=off — the transaction-scoped setting is gone |
| 10:42:15.392 | Client B (application, test_app) | test_app | transaction | 13632 | off | write #1 | OK |
| 10:42:15.880 | Client B (application, test_app) | test_app | transaction | 13632 | off | write #2 | OK |
| 10:42:16.440 | Client B (application, test_app) | test_app | transaction | 13632 | off | write #3 | OK |
| 10:42:17.022 | Client B (application, test_app) | test_app | transaction | 13632 | off | write #4 | OK |
| 10:42:17.599 | Client B (application, test_app) | test_app | transaction | 13632 | off | write #5 | OK |
| 10:42:18.143 | Client B (application, test_app) | test_app | transaction | 13632 | off | write #6 | OK |
| 10:42:18.753 | Client B (application, test_app) | test_app | transaction | 13632 | off | write #7 | OK |
| 10:42:19.295 | Client B (application, test_app) | test_app | transaction | 13632 | off | write #8 | OK |
| 10:42:19.878 | Client B (application, test_app) | test_app | transaction | 13632 | off | write #9 | OK |
| 10:42:20.686 | Client B (application, test_app) | test_app | transaction | 13632 | off | write #10 | OK |
| 10:42:21.169 | Client B (application, test_app) | test_app | transaction | 13632 | off | write #11 | OK |
| 10:42:21.772 | Client B (application, test_app) | test_app | transaction | 13632 | off | write #12 | OK |
| 10:42:22.339 | Client B (application, test_app) | test_app | transaction | 13632 | off | write #13 | OK |
| 10:42:22.869 | Client B (application, test_app) | test_app | transaction | 13632 | off | write #14 | OK |
| 10:42:23.781 | Client B (application, test_app) | test_app | transaction | 13632 | off | write #15 | OK |
| 10:42:24.272 | Client B (application, test_app) | test_app | transaction | 13632 | off | write #16 | OK |
| 10:42:24.836 | Client B (application, test_app) | test_app | transaction | 13632 | off | write #17 | OK |
| 10:42:25.377 | Client B (application, test_app) | test_app | transaction | 13632 | off | write #18 | OK |
| 10:42:25.878 | Client B (application, test_app) | test_app | transaction | 13632 | off | write #19 | OK |
| 10:42:26.406 | Client B (application, test_app) | test_app | transaction | 13632 | off | write #20 | OK |

**What this shows:** BEGIN READ ONLY blocks writes inside that transaction only. SET LOCAL reverts at COMMIT, so the next transaction on the same backend is read-write.

**Not shown by this test:** Tools that cannot be told to use BEGIN READ ONLY (some GUI clients issue session-level SETs themselves).

## Test 4 · Permission checks — PASS

Every allowed action worked and every forbidden action was denied (42501).


| Time (UTC) | Client | Login role | Mode | Backend PID | default_ro | Step | Result |
|---|---|---|---|---|---|---|---|
| 10:42:27.736 | test_readonly_human | test_readonly_human | session | 13639 | off | Human read-only can SELECT  [expect allowed] | PASS (allowed) — select count(*) from pool_test.events  →  SELECT 1 |
| 10:42:28.151 | test_readonly_human | test_readonly_human | session | 13639 | off | Human read-only cannot INSERT  [expect denied] | PASS (denied) — insert into pool_test.events (source) values ('human')  →  permission denied for table events |
| 10:42:28.536 | test_readonly_human | test_readonly_human | session | 13639 | off | Human read-only cannot UPDATE  [expect denied] | PASS (denied) — update pool_test.events set note = 'x' where false  →  permission denied for table events |
| 10:42:29.026 | test_readonly_human | test_readonly_human | session | 13639 | off | Human read-only cannot DELETE  [expect denied] | PASS (denied) — delete from pool_test.events where false  →  permission denied for table events |
| 10:42:30.165 | test_delivery | test_delivery | session | 13625 | off | Delivery cannot INSERT  [expect denied] | PASS (denied) — insert into pool_test.events (source) values ('delivery')  →  permission denied for table events |
| 10:42:30.784 | test_delivery | test_delivery | session | 13625 | off | Delivery cannot SET ROLE test_app  [expect denied] | PASS (denied) — set role test_app  →  permission denied to set role "test_app" |
| 10:42:31.267 | test_delivery | test_delivery | session | 13625 | off | Delivery cannot SET SESSION AUTHORIZATION test_app  [expect denied] | PASS (denied) — set session authorization test_app  →  permission denied to set session authorization "test_app" |
| 10:42:31.919 | test_delivery | test_delivery | session | 13625 | off | Delivery is not a member of test_app  [expect allowed] | PASS (allowed) — do $$ begin if pg_has_role('test_delivery', 'test_app', 'member') then raise exception 'test_delivery IS a member of test_app'; end if; end $$  →  DO |
| 10:42:33.068 | test_app | test_app | transaction | 13632 | off | App cannot UPDATE (append-only)  [expect denied] | PASS (denied) — update pool_test.events set note = 'x' where false  →  permission denied for table events |
| 10:42:33.485 | test_app | test_app | transaction | 13632 | off | App cannot DELETE (append-only)  [expect denied] | PASS (denied) — delete from pool_test.events where false  →  permission denied for table events |
| 10:42:34.629 | test_maint | test_maint | session | 13643 | off | Maintenance can SELECT  [expect allowed] | PASS (allowed) — select count(*) from pool_test.events  →  SELECT 1 |
| 10:42:35.040 | test_maint | test_maint | session | 13643 | off | Maintenance can DELETE test rows (0 rows targeted)  [expect allowed] | PASS (allowed) — delete from pool_test.events where source = '__none__'  →  DELETE 0 |
| 10:42:35.707 | test_maint | test_maint | session | 13643 | off | Maintenance cannot INSERT  [expect denied] | PASS (denied) — insert into pool_test.events (source) values ('maint')  →  permission denied for table events |
| 10:42:36.116 | test_maint | test_maint | session | 13643 | off | Maintenance cannot CREATE TABLE in pool_test  [expect denied] | PASS (denied) — create table pool_test.maint_probe (id int)  →  permission denied for schema pool_test |
| 10:42:36.542 | test_maint | test_maint | session | 13643 | off | Maintenance cannot CREATE ROLE  [expect denied] | PASS (denied) — create role maint_probe_role  →  permission denied to create role |
| 10:42:36.938 | test_maint | test_maint | session | 13643 | off | Maintenance cannot read auth.users  [expect denied] | PASS (denied) — select count(*) from auth.users  →  permission denied for schema auth |
| 10:42:37.286 | test_maint | test_maint | session | 13643 | off | Maintenance cannot SET ROLE test_app  [expect denied] | PASS (denied) — set role test_app  →  permission denied to set role "test_app" |
| 10:42:42.235 | Admin (Management API) | postgres | admin |  |  | Role memberships held by test_* roles [expect none] | PASS — none |

**What this shows:** The synthetic roles behave as designed on this disposable project.

**Not shown by this test:** These four roles are a test fixture, NOT a production least-privilege policy: real roles also need RLS review, function/sequence grants, default privileges, connection limits, statement timeouts and password/rotation policy.
