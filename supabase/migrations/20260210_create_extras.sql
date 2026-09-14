create table if not exists public.extras (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null,
  description text,
  amount_cents integer not null default 0 check (amount_cents >= 0),
  amount_is_per_person boolean not null default false,
  collection_mode text not null default 'project_collector'
    check (collection_mode in ('project_collector', 'dedicated_collector')),
  dedicated_collector_participant_id uuid references public.participants (id) on delete set null,
  check (
    (collection_mode = 'project_collector' and dedicated_collector_participant_id is null)
    or
    (collection_mode = 'dedicated_collector' and dedicated_collector_participant_id is not null)
  ),
  created_by uuid not null references public.users (id),
  created_at timestamptz not null default now()
);

create table if not exists public.extra_memberships (
  id uuid primary key default gen_random_uuid(),
  extra_id uuid not null references public.extras (id) on delete cascade,
  participant_id uuid not null references public.participants (id) on delete cascade,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  unique (extra_id, participant_id)
);

create index if not exists extras_project_id_idx on public.extras (project_id);
create index if not exists extras_created_at_idx on public.extras (created_at desc);
create index if not exists extras_dedicated_collector_idx on public.extras (dedicated_collector_participant_id);
create index if not exists extra_memberships_extra_id_idx on public.extra_memberships (extra_id);
create index if not exists extra_memberships_participant_id_idx on public.extra_memberships (participant_id);
create index if not exists extra_memberships_active_idx
  on public.extra_memberships (extra_id, participant_id)
  where left_at is null;

alter table public.extras enable row level security;
alter table public.extra_memberships enable row level security;

create policy "extras_select_participants"
on public.extras
for select
using (
  exists (
    select 1
    from public.participants p
    where p.project_id = extras.project_id
      and p.user_id = auth.uid()
      and p.left_at is null
  )
);

create policy "extras_insert_participants"
on public.extras
for insert
with check (
  created_by = auth.uid()
  and exists (
    select 1
    from public.participants p
    where p.project_id = extras.project_id
      and p.user_id = auth.uid()
      and p.left_at is null
  )
);

create policy "extras_update_creator_or_collector"
on public.extras
for update
using (
  created_by = auth.uid()
  or exists (
    select 1
    from public.projects pr
    join public.participants p on p.id = pr.collector_participant_id
    where pr.id = extras.project_id
      and p.user_id = auth.uid()
      and p.left_at is null
  )
)
with check (
  created_by = auth.uid()
  or exists (
    select 1
    from public.projects pr
    join public.participants p on p.id = pr.collector_participant_id
    where pr.id = extras.project_id
      and p.user_id = auth.uid()
      and p.left_at is null
  )
);

create policy "extra_memberships_select_participants"
on public.extra_memberships
for select
using (
  exists (
    select 1
    from public.extras ex
    join public.participants p on p.project_id = ex.project_id
    where ex.id = extra_memberships.extra_id
      and p.user_id = auth.uid()
      and p.left_at is null
  )
);

create policy "extra_memberships_insert_self"
on public.extra_memberships
for insert
with check (
  exists (
    select 1
    from public.extras ex
    join public.participants p on p.project_id = ex.project_id
    where ex.id = extra_memberships.extra_id
      and p.id = extra_memberships.participant_id
      and p.user_id = auth.uid()
      and p.left_at is null
  )
);

create policy "extra_memberships_update_self"
on public.extra_memberships
for update
using (
  exists (
    select 1
    from public.extras ex
    join public.participants p on p.project_id = ex.project_id
    where ex.id = extra_memberships.extra_id
      and p.id = extra_memberships.participant_id
      and p.user_id = auth.uid()
      and p.left_at is null
  )
)
with check (
  exists (
    select 1
    from public.extras ex
    join public.participants p on p.project_id = ex.project_id
    where ex.id = extra_memberships.extra_id
      and p.id = extra_memberships.participant_id
      and p.user_id = auth.uid()
      and p.left_at is null
  )
);
