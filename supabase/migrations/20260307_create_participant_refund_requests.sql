create table if not exists public.participant_refund_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  participant_id uuid not null references public.participants (id) on delete cascade,
  collector_participant_id uuid not null references public.participants (id) on delete cascade,
  requested_by_participant_id uuid not null references public.participants (id) on delete cascade,
  base_amount_cents integer not null default 0 check (base_amount_cents >= 0),
  extras_amount_cents integer not null default 0 check (extras_amount_cents >= 0),
  total_amount_cents integer not null default 0 check (total_amount_cents >= 0),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'sent', 'completed', 'canceled')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by_participant_id uuid references public.participants (id) on delete set null,
  collector_marked_sent_at timestamptz,
  participant_confirmed_at timestamptz,
  completed_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (total_amount_cents = (base_amount_cents + extras_amount_cents))
);

create index if not exists participant_refund_requests_project_idx
  on public.participant_refund_requests (project_id, created_at desc);
create index if not exists participant_refund_requests_participant_idx
  on public.participant_refund_requests (participant_id, created_at desc);
create index if not exists participant_refund_requests_collector_idx
  on public.participant_refund_requests (collector_participant_id, status, created_at desc);
create unique index if not exists participant_refund_requests_open_unique
  on public.participant_refund_requests (project_id, participant_id)
  where status in ('pending', 'approved', 'sent');

alter table public.participant_refund_requests enable row level security;

create policy "participant_refund_requests_select_participants"
on public.participant_refund_requests
for select
using (
  exists (
    select 1
    from public.participants p
    where p.project_id = participant_refund_requests.project_id
      and p.user_id = auth.uid()
      and p.left_at is null
  )
);

create policy "participant_refund_requests_insert_self"
on public.participant_refund_requests
for insert
with check (
  participant_id = requested_by_participant_id
  and exists (
    select 1
    from public.participants p
    where p.id = participant_refund_requests.participant_id
      and p.project_id = participant_refund_requests.project_id
      and p.user_id = auth.uid()
      and p.left_at is null
  )
);

create policy "participant_refund_requests_update_collector_only"
on public.participant_refund_requests
for update
using (
  exists (
    select 1
    from public.participants p
    where p.id = participant_refund_requests.collector_participant_id
      and p.project_id = participant_refund_requests.project_id
      and p.user_id = auth.uid()
      and p.left_at is null
  )
)
with check (
  exists (
    select 1
    from public.participants p
    where p.id = participant_refund_requests.collector_participant_id
      and p.project_id = participant_refund_requests.project_id
      and p.user_id = auth.uid()
      and p.left_at is null
  )
);

alter table if exists public.activity_logs
  drop constraint if exists activity_logs_entry_type_check;

alter table if exists public.activity_logs
  add constraint activity_logs_entry_type_check
  check (
    entry_type in (
      'project_created',
      'project_updated',
      'project_status_changed',
      'collector_changed',
      'participant_joined',
      'participant_left',
      'join_request_submitted',
      'join_request_approved',
      'join_request_rejected',
      'join_request_canceled',
      'payment_reported',
      'payment_confirmed',
      'payment_unconfirmed',
      'late_transfer_created',
      'late_transfer_sender_marked',
      'late_transfer_collector_confirmed',
      'poll_created',
      'poll_updated',
      'poll_deleted',
      'poll_vote_cast',
      'poll_vote_changed',
      'extra_created',
      'extra_updated',
      'extra_joined',
      'extra_left',
      'extra_collector_changed',
      'extra_deleted',
      'refund_requested',
      'refund_approved',
      'refund_rejected',
      'refund_sent',
      'refund_completed'
    )
  );
