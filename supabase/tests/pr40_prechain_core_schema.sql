\set ON_ERROR_STOP on

-- Disposable pre-repository baseline. The repository starts with incremental
-- migrations, so this recreates the core schema those migrations historically
-- assumed. No Production data or secrets are copied.
create extension if not exists pgcrypto;

do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

-- Supabase grants its service role access to subsequently created public
-- objects. Reproduce those defaults before applying the repository chain.
alter default privileges for role postgres in schema public
  grant all on tables to service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to service_role;

create table public.users (
  id uuid primary key,
  email text,
  display_name text
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  status text not null default 'draft',
  created_by uuid references public.users(id),
  collector_participant_id uuid,
  total_cents integer not null default 0,
  max_participants integer,
  event_date date,
  deadline_at timestamptz,
  finalized_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_status_check check (status in ('draft', 'collecting', 'closed', 'cancelled'))
);

create table public.participants (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null default 'member' check (role in ('member', 'organizer')),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  unique(project_id, user_id)
);
alter table public.projects add constraint projects_collector_participant_id_fkey
  foreign key (collector_participant_id) references public.participants(id) on delete set null;

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.users(id),
  author_user_id uuid not null references public.users(id),
  body text not null,
  created_at timestamptz not null default now()
);

create table public.payment_options (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  type text not null,
  label text,
  value text not null,
  priority integer not null default 1,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.user_payment_options (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  type text not null,
  label text,
  value text not null,
  priority integer default 1,
  is_active boolean default true,
  created_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  is_counted boolean not null default false,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

create table public.payment_signals (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  cleared_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.late_join_transfers (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  from_participant_id uuid not null references public.participants(id) on delete restrict,
  to_participant_id uuid not null references public.participants(id) on delete restrict,
  expected_cents integer not null check (expected_cents >= 0),
  sender_marked_at timestamptz,
  received_at timestamptz,
  created_at timestamptz not null default now(),
  unique(project_id, from_participant_id, to_participant_id)
);

create table public.addons (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  description text,
  extra_cents integer not null default 0,
  required_votes integer not null default 1,
  created_at timestamptz not null default now()
);
create table public.addon_votes (
  id uuid primary key default gen_random_uuid(),
  addon_id uuid not null references public.addons(id) on delete cascade,
  unique(addon_id)
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id),
  actor_id uuid,
  action text not null,
  details jsonb,
  created_at timestamptz not null default now()
);

create table public.join_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  requester_user_id uuid not null references public.users(id) on delete cascade,
  status text not null default 'pending',
  approved_by uuid references public.users(id),
  approved_at timestamptz,
  participant_id uuid references public.participants(id),
  created_at timestamptz not null default now(),
  unique(project_id, requester_user_id)
);

create table public.project_invites (
  project_id uuid primary key references public.projects(id) on delete cascade,
  invite_version integer not null default 1
);

alter table public.users enable row level security;
alter table public.projects enable row level security;
alter table public.participants enable row level security;
alter table public.messages enable row level security;
alter table public.payment_options enable row level security;
alter table public.user_payment_options enable row level security;
alter table public.payments enable row level security;
alter table public.payment_signals enable row level security;
alter table public.late_join_transfers enable row level security;
alter table public.addons enable row level security;
alter table public.addon_votes enable row level security;
alter table public.join_requests enable row level security;
alter table public.project_invites enable row level security;

grant all on all tables in schema public to anon, authenticated, service_role;

-- Representative legacy policies are intentionally replaced by the lockdown
-- migration; their presence exercises DROP/replace compatibility.
create policy "proj_read" on public.projects for select to public using (true);
create policy "proj_write" on public.projects for insert to public with check (true);
create policy "proj_update" on public.projects for update to public using (true);
create policy "participants_read_any" on public.participants for select to authenticated using (true);
create policy "participants_insert_guard" on public.participants for insert to authenticated with check (true);
create policy "msg_select" on public.messages for select to public using (true);
create policy "payopt_read" on public.payment_options for select to public using (true);
create policy "pay_select" on public.payments for select to public using (true);
create policy "payments_insert_guard" on public.payments for insert to authenticated with check (true);
create policy "payment_signals_select" on public.payment_signals for select to authenticated using (true);
create policy "payment_signals_insert" on public.payment_signals for insert to authenticated with check (true);
create policy "late_join_transfers_read_for_members" on public.late_join_transfers for select to authenticated using (true);
create policy "late_join_sender_can_mark_paid" on public.late_join_transfers for update to authenticated using (true) with check (true);
create policy "addon_insert" on public.addons for insert to public with check (true);
create policy "addon_select" on public.addons for select to public using (true);
create policy "votes_insert" on public.addon_votes for insert to public with check (true);
create policy "votes_select" on public.addon_votes for select to public using (true);
create policy "join_requests_insert_self" on public.join_requests for insert to authenticated with check (true);
create policy "join_requests_select_self" on public.join_requests for select to authenticated using (true);
create policy "users_select_display" on public.users for select to authenticated using (true);
create policy "users_update_own" on public.users for update to authenticated using (true) with check (true);
create policy "upo_select" on public.user_payment_options for select to public using (true);
create policy "upo_write" on public.user_payment_options for insert to public with check (true);
create policy "upo_update" on public.user_payment_options for update to public using (true) with check (true);
create policy "upo_delete" on public.user_payment_options for delete to public using (true);

-- A representative pre-chain participant trigger ensures the new capacity
-- trigger coexists with an existing collector-maintenance writer.
create or replace function public.clear_collector_on_participant_leave()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.left_at is null and new.left_at is not null then
    update public.projects set collector_participant_id = null
    where id = new.project_id and collector_participant_id = new.id;
  end if;
  return new;
end
$$;
create trigger participants_clear_collector
after update of left_at on public.participants
for each row execute function public.clear_collector_on_participant_leave();

-- Realistic immutable legacy history is present before any repository
-- migration. Later tests assert the exact rows survive the full chain.
insert into public.users(id,email,display_name) values
  ('00000000-0000-4000-8000-000000000001','legacy-owner@example.invalid','Legacy Owner'),
  ('00000000-0000-4000-8000-000000000002','legacy-member@example.invalid','Legacy Member');
insert into public.projects(id,title,status,created_by,total_cents,max_participants,finalized_at)
values ('00000000-1000-4000-8000-000000000001','Legacy financial history','collecting',
  '00000000-0000-4000-8000-000000000001',8000,5,now());
insert into public.participants(id,project_id,user_id,role,joined_at) values
  ('00000000-2000-4000-8000-000000000001','00000000-1000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','organizer','2025-01-01'),
  ('00000000-2000-4000-8000-000000000002','00000000-1000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','member','2025-01-02');
update public.projects set collector_participant_id='00000000-2000-4000-8000-000000000001'
where id='00000000-1000-4000-8000-000000000001';
insert into public.payments(id,participant_id,is_counted,created_by,created_at)
values ('00000000-3000-4000-8000-000000000001','00000000-2000-4000-8000-000000000002',true,'00000000-0000-4000-8000-000000000001','2025-02-01');
insert into public.payment_signals(id,participant_id,created_at)
values ('00000000-3100-4000-8000-000000000001','00000000-2000-4000-8000-000000000002','2025-01-31');
insert into public.late_join_transfers(id,project_id,from_participant_id,to_participant_id,expected_cents,created_at)
values ('00000000-3200-4000-8000-000000000001','00000000-1000-4000-8000-000000000001','00000000-2000-4000-8000-000000000002','00000000-2000-4000-8000-000000000001',4000,'2025-02-02');
insert into public.audit_logs(id,project_id,actor_id,action,details,created_at)
values ('00000000-3300-4000-8000-000000000001','00000000-1000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','legacy.fixture','{"immutable":true}','2025-02-03');
