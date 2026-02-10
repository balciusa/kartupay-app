create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  occurred_at timestamptz not null default now(),
  entry_type text not null check (
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
      'extra_deleted'
    )
  ),
  actor_user_id uuid references public.users (id) on delete set null,
  actor_participant_id uuid references public.participants (id) on delete set null,
  target_user_id uuid references public.users (id) on delete set null,
  target_participant_id uuid references public.participants (id) on delete set null,
  payment_id uuid,
  poll_id uuid,
  extra_id uuid,
  join_request_id uuid,
  late_transfer_id uuid,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists activity_logs_project_occurred_idx
  on public.activity_logs (project_id, occurred_at desc);
create index if not exists activity_logs_project_entry_idx
  on public.activity_logs (project_id, entry_type, occurred_at desc);
create index if not exists activity_logs_actor_user_idx
  on public.activity_logs (actor_user_id);
create index if not exists activity_logs_target_user_idx
  on public.activity_logs (target_user_id);

alter table public.activity_logs enable row level security;

create policy "activity_logs_select_collector"
on public.activity_logs
for select
using (
  exists (
    select 1
    from public.projects pr
    join public.participants p on p.id = pr.collector_participant_id
    where pr.id = activity_logs.project_id
      and p.user_id = auth.uid()
      and p.left_at is null
  )
);
