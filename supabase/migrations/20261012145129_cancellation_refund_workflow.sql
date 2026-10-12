begin;

-- This table is absent from Production even though an older repository
-- migration describes it. Create it forward-only and harden an existing copy
-- without changing migration history.
create table if not exists public.participant_refund_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  participant_id uuid not null,
  collector_participant_id uuid not null,
  requested_by_participant_id uuid not null,
  base_amount_cents integer not null default 0,
  extras_amount_cents integer not null default 0,
  late_transfer_amount_cents integer not null default 0,
  total_amount_cents integer not null default 0,
  status text not null default 'pending',
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by_participant_id uuid,
  collector_marked_sent_at timestamptz,
  participant_confirmed_at timestamptz,
  completed_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.participant_refund_requests
  add column if not exists late_transfer_amount_cents integer not null default 0;

-- Replace legacy generated constraints with explicit, stable constraints.
alter table public.participant_refund_requests
  drop constraint if exists participant_refund_requests_project_id_fkey,
  drop constraint if exists participant_refund_requests_participant_id_fkey,
  drop constraint if exists participant_refund_requests_collector_participant_id_fkey,
  drop constraint if exists participant_refund_requests_requested_by_participant_id_fkey,
  drop constraint if exists participant_refund_requests_decided_by_participant_id_fkey,
  drop constraint if exists participant_refund_requests_base_amount_cents_check,
  drop constraint if exists participant_refund_requests_extras_amount_cents_check,
  drop constraint if exists participant_refund_requests_late_transfer_amount_cents_check,
  drop constraint if exists participant_refund_requests_total_amount_cents_check,
  drop constraint if exists participant_refund_requests_status_check,
  drop constraint if exists participant_refund_requests_check,
  drop constraint if exists participant_refund_requests_check1;

alter table public.participant_refund_requests
  add constraint participant_refund_requests_project_id_fkey
    foreign key (project_id) references public.projects (id) on delete restrict,
  add constraint participant_refund_requests_participant_id_fkey
    foreign key (participant_id) references public.participants (id) on delete restrict,
  add constraint participant_refund_requests_collector_participant_id_fkey
    foreign key (collector_participant_id) references public.participants (id) on delete restrict,
  add constraint participant_refund_requests_requested_by_participant_id_fkey
    foreign key (requested_by_participant_id) references public.participants (id) on delete restrict,
  add constraint participant_refund_requests_decided_by_participant_id_fkey
    foreign key (decided_by_participant_id) references public.participants (id) on delete set null,
  add constraint participant_refund_requests_base_amount_cents_check
    check (base_amount_cents >= 0),
  add constraint participant_refund_requests_extras_amount_cents_check
    check (extras_amount_cents >= 0),
  add constraint participant_refund_requests_late_transfer_amount_cents_check
    check (late_transfer_amount_cents >= 0),
  add constraint participant_refund_requests_total_amount_cents_check
    check (
      total_amount_cents >= 0
      and total_amount_cents = base_amount_cents + extras_amount_cents + late_transfer_amount_cents
    ),
  add constraint participant_refund_requests_status_check
    check (status in ('pending', 'approved', 'rejected', 'sent', 'completed', 'canceled'));

create index if not exists participant_refund_requests_project_idx
  on public.participant_refund_requests (project_id, created_at desc);
create index if not exists participant_refund_requests_participant_idx
  on public.participant_refund_requests (participant_id, created_at desc);
create index if not exists participant_refund_requests_collector_idx
  on public.participant_refund_requests (collector_participant_id, status, created_at desc);

drop index if exists public.participant_refund_requests_open_unique;
create unique index if not exists participant_refund_requests_open_recipient_unique
  on public.participant_refund_requests (project_id, participant_id, collector_participant_id)
  where status in ('pending', 'approved', 'sent');

alter table public.participant_refund_requests enable row level security;

drop policy if exists "participant_refund_requests_select_participants"
  on public.participant_refund_requests;
drop policy if exists "participant_refund_requests_insert_self"
  on public.participant_refund_requests;
drop policy if exists "participant_refund_requests_update_collector_only"
  on public.participant_refund_requests;
drop policy if exists "participant_refund_requests_select_active_project"
  on public.participant_refund_requests;

-- Members may read project-scoped manual refund state. All mutations use
-- service-role server actions that perform explicit caller authorization and
-- state-transition checks.
create policy "participant_refund_requests_select_active_project"
on public.participant_refund_requests
for select
to authenticated
using (private.kartupay_is_active_project_member(project_id));

revoke all privileges on table public.participant_refund_requests from anon, authenticated;
grant select on table public.participant_refund_requests to authenticated;
grant all privileges on table public.participant_refund_requests to service_role;

comment on table public.participant_refund_requests is
  'Manual refund workflow state only; no automatic money movement.';
comment on column public.participant_refund_requests.collector_participant_id is
  'Actual recipient responsible for manually returning this obligation.';

commit;
