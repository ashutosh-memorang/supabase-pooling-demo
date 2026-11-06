# Can a Delivery script break app sign-ups?

> **Proof of concept only.** Use a disposable Supabase project. Do not run this
> against production or shared staging. The demo intentionally changes session
> state and terminates database connections. Its disposable-project guard,
> cleanup and reset verification, and TLS certificate verification need
> improvement before it is reused.

A small, runnable demo of a real incident. A script used **the same database login as the app**,
switched its connections to read-only "to be safe", and exited. Afterwards, app writes through
Supabase's **Supavisor transaction pooler** failed with:

```
ERROR 25006: cannot execute INSERT in a read-only transaction
```

This repo shows the failure, and shows that giving the script **its own login** prevents it.

| Delivery script runs with… | Then the app signs up a user |
|---|---|
| the **app's** login (same connection string) | ❌ fails with 25006, and keeps failing after the script has exited |
| its **own** login (`delivery`) | ✅ works |

---

## 1. Setup (once)

You need **Node.js 20.12+** and a **disposable** Supabase project (never production or staging).

```bash
git clone <this-repo-url> && cd supavisor-pool-isolation-demo
```

```bash
npm install
```

```bash
cp .env.example .env
```

Edit `.env`:

| Key | What to put |
|---|---|
| `APP_DATABASE_URL` | Dashboard → **Connect** → **Transaction pooler** (port **6543**) connection string, with your DB password. This is the app's login, usually `postgres.<project-ref>`. |
| `DELIVERY_DATABASE_URL` | The same string, but with the username **`delivery.<project-ref>`** and a **new password you choose**. |
| `ALLOWED_PROJECT_REF` | Your project ref (the part after `postgres.`). |
| `CONFIRM_DISPOSABLE` | `yes`, once you're sure the project is disposable. |

Then create the demo table and the `delivery` login:

```bash
npm run demo:setup
```

**Connects with:** `APP_DATABASE_URL` (the app's login). **Runs:**

```sql
CREATE TABLE IF NOT EXISTS public.signups (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        text NOT NULL,
  email       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  login_role  text NOT NULL DEFAULT session_user,     -- filled in by the database: who saved the row
  backend_pid int  NOT NULL DEFAULT pg_backend_pid()  -- filled in by the database: which DB process saved it
);
ALTER TABLE public.signups ENABLE ROW LEVEL SECURITY;  -- Supabase's public API keys can't touch it

-- only if the login doesn't exist yet; name and password come from DELIVERY_DATABASE_URL
CREATE ROLE delivery LOGIN PASSWORD '<password from DELIVERY_DATABASE_URL>';
GRANT USAGE ON SCHEMA public TO delivery;
GRANT SELECT ON public.signups TO delivery;            -- Delivery can read sign-ups, not write them
```

## 2. Run it from the command line

Every command below shows **which connection string it uses** and **the exact SQL it sends**.
All of them go through the Supavisor **transaction pooler (port 6543)**.

### Step 1: a normal sign-up works

```bash
npm run signup
```

**Connects with:** `APP_DATABASE_URL` (the app's login). **Runs** (one transaction per sign-up):

```sql
BEGIN;
SELECT pg_backend_pid()                                  AS pid,        -- which DB process we got
       current_user                                      AS login,
       current_setting('default_transaction_read_only')  AS read_only;  -- 'off' = normal
INSERT INTO public.signups (name, email) VALUES ($1, $2) RETURNING id;   -- $1 = name, $2 = email
COMMIT;          -- or ROLLBACK if the INSERT was rejected

-- afterwards, to show the total:
SELECT count(*) FROM public.signups;
```

```
✅ Sign-up saved: Meera (row 44)   [database process 23981, read-only=off]
```

### Step 2: run the Delivery script with the **app's** login, then sign up

```bash
npm run delivery:app-login
```

**Connects with:** `APP_DATABASE_URL`, the **same login as the app** (this is the mistake). **Runs:**

```sql
BEGIN;
SET default_transaction_read_only = on;   -- ⚠️ the risky line: session level (no LOCAL), so it outlives the transaction
SELECT pg_backend_pid()                                  AS pid,
       current_user                                      AS login,
       current_setting('default_transaction_read_only')  AS read_only;  -- now 'on'
SELECT count(*) FROM public.signups;      -- the script's "check"
SELECT pg_sleep(0.4);
COMMIT;
-- then the script disconnects. The DB process stays open in the pool, still read-only.
```

```
🔧 Delivery script ran as "postgres" (the APP's login)
   SET default_transaction_read_only = on  →  database process(es) 23981 are now read-only
   Script exited. Those processes stay open in the pool for that login.
```

Now sign up again (same SQL as Step 1):

```bash
npm run signup -- 3
```

```
❌ Sign-up FAILED for Vikram: cannot execute INSERT in a read-only transaction   [database process 23981, read-only=on]
❌ Sign-up FAILED for Ananya: cannot execute INSERT in a read-only transaction   [database process 23981, read-only=on]
❌ Sign-up FAILED for Kabir: cannot execute INSERT in a read-only transaction   [database process 23981, read-only=on]
```

The app's `SELECT … read_only` now returns `on`, and its `INSERT` is rejected with error **25006**.
The script had already exited, but the app was handed **the same database process (23981)** that the
script left read-only.

### Step 3: reset, run the script with its **own** login, then sign up

First clear the leftover read-only connections:

```bash
npm run demo:reset
```

**Connects with:** `APP_DATABASE_URL`. **Runs:**

```sql
-- end the app login's other pooled DB processes (only ones Supavisor opened; Supabase's own workers are untouched)
SELECT count(pg_terminate_backend(pid)) AS restarted
FROM pg_stat_activity
WHERE usename = current_user
  AND application_name = 'Supavisor'
  AND pid <> pg_backend_pid();
-- and clear the setting on the DB process running this query, in case it is one of the spoiled ones
RESET default_transaction_read_only;
```

Then run the **same script** with Delivery's own login:

```bash
npm run delivery:own-login
```

**Connects with:** `DELIVERY_DATABASE_URL` (the `delivery` login). **Runs:** exactly the same SQL as in
Step 2, including `SET default_transaction_read_only = on`. Only the login is different.

Then sign up again (same SQL as Step 1):

```bash
npm run signup -- 3
```

```
✅ Sign-up saved: Priya (row 45)   [database process 23981, read-only=off]
✅ Sign-up saved: Meera (row 46)   [database process 23981, read-only=off]
✅ Sign-up saved: Priya (row 47)   [database process 23981, read-only=off]
```

The script made **its own** connection read-only (`delivery` login, `delivery` pool). The app's pool
was never touched, so its `read_only` stays `off`.

### See what was really saved

```bash
npm run demo:check
```

**Connects with:** `APP_DATABASE_URL`. **Runs:**

```sql
SELECT count(*) FROM public.signups;
SELECT id, name, created_at, login_role, backend_pid
FROM public.signups
ORDER BY id DESC
LIMIT 10;   -- sent as LIMIT $1 with 10
```

Failed sign-ups never become rows. You can run the same query in the Supabase SQL Editor, or open the
table in the Table Editor (schema `public`, table `signups`).

### All commands at a glance

| Command | Connects with | What it runs |
|---|---|---|
| `npm run demo:setup` | `APP_DATABASE_URL` | `CREATE TABLE public.signups …`, `CREATE ROLE delivery …`, `GRANT SELECT …` |
| `npm run signup` | `APP_DATABASE_URL` | `BEGIN; SELECT pg_backend_pid() …; INSERT INTO public.signups …; COMMIT;` |
| `npm run delivery:app-login` | `APP_DATABASE_URL` ❌ | `BEGIN; SET default_transaction_read_only = on; SELECT …; SELECT count(*) FROM public.signups; COMMIT;` |
| `npm run delivery:own-login` | `DELIVERY_DATABASE_URL` ✅ | the same SQL as above |
| `npm run demo:reset` | `APP_DATABASE_URL` | `SELECT pg_terminate_backend(pid) … WHERE usename = current_user AND application_name = 'Supavisor'`; `RESET default_transaction_read_only;` |
| `npm run demo:check` | `APP_DATABASE_URL` | `SELECT … FROM public.signups ORDER BY id DESC LIMIT 10;` |
| `npm run demo:cleanup` | `APP_DATABASE_URL` | end `delivery`'s DB processes, `DROP TABLE public.signups`, `DROP ROLE delivery` |

Code: [scripts/demo/](scripts/demo/) and [lib/signup.mjs](lib/signup.mjs). The same queries as plain
SQL files for `psql` are in [sql/demo/](sql/demo/).

Optional: `npm run delivery:app-login -- --connections 8` runs the script on 8 connections at once,
like a tool with a small connection pool, so it spoils up to 8 DB processes.

## 3. Or click through it in the browser

```bash
npm run demo
```

Open http://127.0.0.1:3000: a sign-up form next to the Delivery script, with the same three steps.

## 4. Why it happens

Supavisor keeps a **separate pool of open database connections for each login**, and in transaction
mode it lends any free one to each transaction.

```
Same login:                                  Separate logins:
  App ─────┐                                   App ──────► pool for postgres ─► connections (normal)     ✅
           ├─► ONE pool ─► connections         Delivery ─► pool for delivery ─► connections (read-only)  (only Delivery's)
  Delivery ┘   (Delivery left some read-only) ❌
```

- `SET …` (without `LOCAL`) changes the **database connection**, not just the transaction. It stays
  after `COMMIT` and after the script disconnects.
- With the same login, that connection goes back into **the app's** pool, and app writes that borrow it fail.
- With its own login, Delivery can only spoil connections in **its own** pool.

**Why only some writes fail in real life:** the app's pool usually has several connections, and the
script spoils only the ones it used. A request fails only if it borrows a spoiled one, so failures look
random. In this demo the pool is small, so it fails every time.

## 5. Notes from testing (honest caveats)

- **The client matters.** In our tests, a script using a **driver** (Node.js `pg`, like this one) left
  the read-only connection in the pool every time. When the same SQL ran from **`psql`**, Supavisor
  usually (13 of 14 runs) closed that connection when `psql` disconnected, so the app was unaffected.
  Don't rely on that: once it happened anyway, and driver-based scripts and migration tools don't get
  that clean-up. Plain SQL versions are in [sql/demo/](sql/demo/) if you want to try `psql` yourself.
- **A separate login doesn't protect against** settings saved on a role or database
  (`ALTER ROLE … SET …`, `ALTER DATABASE … SET …`). Those apply to every new connection.
- **It only helps if scripts actually use their own login.** Keep the app's connection string out of scripts.
- **Safer scripts:** use `BEGIN READ ONLY` or `SET LOCAL`; those end with the transaction.

## 6. Clean up

```bash
npm run demo:cleanup
```

**Connects with:** `APP_DATABASE_URL`. **Runs:**

```sql
SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE usename = 'delivery';
DROP TABLE IF EXISTS public.signups;
DROP ROLE IF EXISTS delivery;
```

## Safety

- Every command refuses to run unless both connection strings use the Supabase pooler, point at
  `ALLOWED_PROJECT_REF`, and `CONFIRM_DISPOSABLE=yes` ([lib/simple-config.mjs](lib/simple-config.mjs)).
- `.env` is gitignored. No connection strings or passwords are committed.
- `demo:reset` only ends pooled connections that belong to **your app login** and were opened by
  Supavisor (`application_name = 'Supavisor'`). Supabase's own background workers are not touched.

## Files

| Path | Purpose |
|---|---|
| [scripts/demo/](scripts/demo/) | `setup`, `signup`, `delivery-script`, `reset`, `check`, `cleanup` |
| [lib/signup.mjs](lib/signup.mjs) | The app's sign-up and the Delivery script |
| [lib/simple-config.mjs](lib/simple-config.mjs) | Reads the two connection strings and enforces the safety checks |
| [public/signup.html](public/signup.html) + [server.mjs](server.mjs) | The browser version |
| [sql/demo/](sql/demo/) | The same steps as plain SQL for `psql` |
| [docs/LAB.md](docs/LAB.md) | The detailed lab: PID-level experiments, a realistic multi-service test, permission checks, and recorded results |
