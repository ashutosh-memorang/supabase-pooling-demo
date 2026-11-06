-- Realistic scenario, part 2. Runs logged in as test_migrator, so test_migrator owns the
-- tables (as a real migration user would). Synthetic data only.
-- Every table records, filled in BY THE DATABASE, which login and which backend process
-- wrote each row (login_role, backend_pid), plus run_id/service to find a run's rows.

create table if not exists realistic_test.learners (
  id          bigint generated always as identity primary key,
  name        text not null,
  email       text not null,
  created_at  timestamptz not null default now(),
  service     text not null default 'seed',
  run_id      text not null default 'seed',
  login_role  text not null default session_user,
  backend_pid int  not null default pg_backend_pid()
);

create table if not exists realistic_test.assessments (
  id          bigint generated always as identity primary key,
  title       text not null,
  status      text not null default 'open',
  attempts    int  not null default 0,
  updated_at  timestamptz not null default now()
);

create table if not exists realistic_test.submissions (
  id            bigint generated always as identity primary key,
  learner_id    bigint not null references realistic_test.learners (id),
  assessment_id bigint not null references realistic_test.assessments (id),
  score         int not null check (score between 0 and 100),
  submitted_at  timestamptz not null default now(),
  service       text not null,
  run_id        text not null,
  login_role    text not null default session_user,
  backend_pid   int  not null default pg_backend_pid()
);

create table if not exists realistic_test.hub_events (
  id          bigint generated always as identity primary key,
  kind        text not null,
  payload     jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  service     text not null,
  run_id      text not null,
  login_role  text not null default session_user,
  backend_pid int  not null default pg_backend_pid()
);

create index if not exists submissions_run_idx on realistic_test.submissions (run_id);
create index if not exists hub_events_run_idx on realistic_test.hub_events (run_id);
create index if not exists learners_run_idx on realistic_test.learners (run_id);

-- Seed: 200 fake learners and 20 fake assessments (only the first time).
insert into realistic_test.learners (name, email)
select 'Learner ' || g, 'learner' || g || '@example.test'
from generate_series(1, 200) g
where not exists (select 1 from realistic_test.learners);

insert into realistic_test.assessments (title)
select 'Assessment ' || g
from generate_series(1, 20) g
where not exists (select 1 from realistic_test.assessments);

select
  (select count(*) from realistic_test.learners)    as learners,
  (select count(*) from realistic_test.assessments) as assessments,
  (select count(*) from realistic_test.submissions) as submissions,
  (select count(*) from realistic_test.hub_events)  as hub_events;
