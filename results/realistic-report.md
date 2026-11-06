# Realistic run report — 2026-11-06T11:15:46.765Z

Disposable project `sgjsocdtrhztgdrllbcj`, real hosted Supavisor. Services: app, hub, assessment (2 connections each) on
`test_shared` via the transaction pooler for 30 s; migration starts at 6 s.

| Run | Verdict | Attempted | Saved in tables | Rejected 25006 | Shared PIDs | Migration read-only PIDs |
|---|---|---|---|---|---|---|
| Realistic run 1 · everything on one shared login (the incident setup) — attempt 1 | **BLOCKED** | 441 | 387 | 54 | 16418, 16425, 16424 | 16559, 16558, 16418 |
| Realistic run 2 · migration on its own login (Migrator (test_migrator) · transaction pool :6543) | **NOT BLOCKED** | 435 | 435 | 0 | none | 17109, 17107, 17110 |
| Realistic run 2 · migration on its own login (Migrator (test_migrator) · session pool :5432) | **NOT BLOCKED** | 416 | 416 | 0 | none | 17157, 17141, 17158 |

## Realistic run 1 · everything on one shared login (the incident setup) — attempt 1 — BLOCKED

54 of 441 service writes were rejected with 25006 after the migration's read-only check (first at 9.2s). They all ran on backend(s) 16418, which the migration had made read-only.

Run id `R1-shared-login-20261106111310`. Migration path: Shared login (test_shared) · transaction pool :6543.

| Service | Table | Attempted | Saved in table | Rejected 25006 | Other errors | Login in rows |
|---|---|---|---|---|---|---|
| app | learners | 148 | 134 | 14 | 0 | test_shared |
| assessment | submissions | 147 | 132 | 15 | 0 | test_shared |
| hub | hub_events | 146 | 121 | 25 | 0 | test_shared |

| At | Client | Login | PID | default_ro | Migration step | Result |
|---|---|---|---|---|---|---|
| 6.0s | Migration |  |  |  | Migration starts (Shared login (test_shared) · transaction pool :6543) | INFO |
| 7.1s | Migration | test_shared | 16425 | off | Schema change: ALTER TABLE learners ADD COLUMN nickname; CREATE INDEX on email | OK |
| 7.5s | Migration | test_shared | 16424 | off | Backfill: UPDATE learners SET nickname | OK |
| 9.0s | Migration check #3 | test_shared | 16559 | on | Verification: SET default_transaction_read_only = on (session level), check query, COMMIT, disconnect | SETTING APPLIED |
| 9.0s | Migration check #2 | test_shared | 16558 | on | Verification: SET default_transaction_read_only = on (session level), check query, COMMIT, disconnect | SETTING APPLIED |
| 9.0s | Migration check #1 | test_shared | 16418 | on | Verification: SET default_transaction_read_only = on (session level), check query, COMMIT, disconnect | SETTING APPLIED |

Server view at end of run (PID=login): 16419=test_migrator, 16418=test_shared, 16423=test_shared, 16424=test_shared, 16425=test_shared, 16426=test_shared, 16427=test_shared, 16443=test_shared, 16558=test_shared, 16559=test_shared

Check in Supabase SQL Editor:
```sql
select 'learners (app)' as written_by, count(*) as rows_saved from realistic_test.learners where run_id = 'R1-shared-login-20261106111310'
union all select 'submissions (assessment)', count(*) from realistic_test.submissions where run_id = 'R1-shared-login-20261106111310'
union all select 'hub_events (hub)', count(*) from realistic_test.hub_events where run_id = 'R1-shared-login-20261106111310';
```

## Realistic run 2 · migration on its own login (Migrator (test_migrator) · transaction pool :6543) — NOT BLOCKED

All 435 service writes succeeded (435 rows in the tables) while the migration on its own login applied its schema change and set read-only on its own backends 17109, 17107, 17110. Services and migration never shared a backend.

Run id `R2-own-login-tx-20261106111402`. Migration path: Migrator (test_migrator) · transaction pool :6543.

| Service | Table | Attempted | Saved in table | Rejected 25006 | Other errors | Login in rows |
|---|---|---|---|---|---|---|
| app | learners | 148 | 148 | 0 | 0 | test_shared |
| assessment | submissions | 148 | 148 | 0 | 0 | test_shared |
| hub | hub_events | 139 | 139 | 0 | 0 | test_shared |

| At | Client | Login | PID | default_ro | Migration step | Result |
|---|---|---|---|---|---|---|
| 6.0s | Migration |  |  |  | Migration starts (Migrator (test_migrator) · transaction pool :6543) | INFO |
| 7.0s | Migration | test_migrator | 17107 | off | Schema change: ALTER TABLE learners ADD COLUMN nickname; CREATE INDEX on email | OK |
| 7.3s | Migration | test_migrator | 17107 | off | Backfill: UPDATE learners SET nickname | OK |
| 8.8s | Migration check #3 | test_migrator | 17109 | on | Verification: SET default_transaction_read_only = on (session level), check query, COMMIT, disconnect | SETTING APPLIED |
| 8.8s | Migration check #2 | test_migrator | 17107 | on | Verification: SET default_transaction_read_only = on (session level), check query, COMMIT, disconnect | SETTING APPLIED |
| 9.1s | Migration check #1 | test_migrator | 17110 | on | Verification: SET default_transaction_read_only = on (session level), check query, COMMIT, disconnect | SETTING APPLIED |

Server view at end of run (PID=login): 17095=test_migrator, 17107=test_migrator, 17109=test_migrator, 17110=test_migrator, 17096=test_shared, 17100=test_shared, 17101=test_shared, 17102=test_shared, 17103=test_shared, 17104=test_shared

Check in Supabase SQL Editor:
```sql
select 'learners (app)' as written_by, count(*) as rows_saved from realistic_test.learners where run_id = 'R2-own-login-tx-20261106111402'
union all select 'submissions (assessment)', count(*) from realistic_test.submissions where run_id = 'R2-own-login-tx-20261106111402'
union all select 'hub_events (hub)', count(*) from realistic_test.hub_events where run_id = 'R2-own-login-tx-20261106111402';
```

## Realistic run 2 · migration on its own login (Migrator (test_migrator) · session pool :5432) — NOT BLOCKED

All 416 service writes succeeded (416 rows in the tables) while the migration on its own login applied its schema change and set read-only on its own backends 17157, 17141, 17158. Services and migration never shared a backend.

Run id `R2-own-login-session-20261106111454`. Migration path: Migrator (test_migrator) · session pool :5432.

| Service | Table | Attempted | Saved in table | Rejected 25006 | Other errors | Login in rows |
|---|---|---|---|---|---|---|
| app | learners | 145 | 145 | 0 | 0 | test_shared |
| assessment | submissions | 144 | 144 | 0 | 0 | test_shared |
| hub | hub_events | 127 | 127 | 0 | 0 | test_shared |

| At | Client | Login | PID | default_ro | Migration step | Result |
|---|---|---|---|---|---|---|
| 6.0s | Migration |  |  |  | Migration starts (Migrator (test_migrator) · session pool :5432) | INFO |
| 7.1s | Migration | test_migrator | 17141 | off | Schema change: ALTER TABLE learners ADD COLUMN nickname; CREATE INDEX on email | OK |
| 7.6s | Migration | test_migrator | 17141 | off | Backfill: UPDATE learners SET nickname | OK |
| 9.1s | Migration check #3 | test_migrator | 17157 | on | Verification: SET default_transaction_read_only = on (session level), check query, COMMIT, disconnect | SETTING APPLIED |
| 9.2s | Migration check #1 | test_migrator | 17141 | on | Verification: SET default_transaction_read_only = on (session level), check query, COMMIT, disconnect | SETTING APPLIED |
| 9.2s | Migration check #2 | test_migrator | 17158 | on | Verification: SET default_transaction_read_only = on (session level), check query, COMMIT, disconnect | SETTING APPLIED |

Server view at end of run (PID=login): 17141=test_migrator, 17143=test_migrator, 17157=test_migrator, 17158=test_migrator, 17142=test_shared, 17148=test_shared, 17149=test_shared, 17150=test_shared, 17151=test_shared, 17152=test_shared

Check in Supabase SQL Editor:
```sql
select 'learners (app)' as written_by, count(*) as rows_saved from realistic_test.learners where run_id = 'R2-own-login-session-20261106111454'
union all select 'submissions (assessment)', count(*) from realistic_test.submissions where run_id = 'R2-own-login-session-20261106111454'
union all select 'hub_events (hub)', count(*) from realistic_test.hub_events where run_id = 'R2-own-login-session-20261106111454';
```
