create table if not exists public.extra_payments (
  id uuid primary key default gen_random_uuid(),
  extra_id uuid not null references public.extras (id) on delete cascade,
  payer_participant_id uuid not null references public.participants (id) on delete cascade,
  collector_participant_id uuid not null references public.participants (id) on delete cascade,
  amount_cents integer not null default 0 check (amount_cents >= 0),
  reported_at timestamptz,
  confirmed_at timestamptz,
  confirmed_by_participant_id uuid references public.participants (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (extra_id, payer_participant_id)
);

create index if not exists extra_payments_extra_id_idx on public.extra_payments (extra_id);
create index if not exists extra_payments_payer_idx on public.extra_payments (payer_participant_id);
create index if not exists extra_payments_collector_idx on public.extra_payments (collector_participant_id);
create index if not exists extra_payments_confirmed_idx on public.extra_payments (confirmed_at);
create index if not exists extra_payments_reported_pending_idx
  on public.extra_payments (collector_participant_id, reported_at)
  where confirmed_at is null;

alter table public.extra_payments enable row level security;

create policy "extra_payments_select_participants"
on public.extra_payments
for select
using (
  exists (
    select 1
    from public.extras ex
    join public.participants p on p.project_id = ex.project_id
    where ex.id = extra_payments.extra_id
      and p.user_id = auth.uid()
      and p.left_at is null
  )
);

