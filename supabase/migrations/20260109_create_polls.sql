create table if not exists public.polls (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null,
  description text,
  extra_cents integer not null default 0,
  required_votes integer not null default 1,
  created_by uuid not null references public.users (id),
  created_at timestamptz not null default now()
);

create table if not exists public.poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls (id) on delete cascade,
  label text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.poll_votes (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls (id) on delete cascade,
  option_id uuid not null references public.poll_options (id) on delete cascade,
  user_id uuid not null references public.users (id),
  created_at timestamptz not null default now(),
  unique (poll_id, user_id)
);

create index if not exists poll_options_poll_id_idx on public.poll_options (poll_id);
create index if not exists poll_votes_poll_id_idx on public.poll_votes (poll_id);
create index if not exists poll_votes_option_id_idx on public.poll_votes (option_id);
create index if not exists poll_votes_user_id_idx on public.poll_votes (user_id);

alter table public.polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes enable row level security;

create policy "polls_select_participants"
on public.polls
for select
using (
  exists (
    select 1
    from public.participants p
    where p.project_id = polls.project_id
      and p.user_id = auth.uid()
      and p.left_at is null
  )
);

create policy "polls_insert_participants"
on public.polls
for insert
with check (
  created_by = auth.uid()
  and exists (
    select 1
    from public.participants p
    where p.project_id = polls.project_id
      and p.user_id = auth.uid()
      and p.left_at is null
  )
);

create policy "poll_options_select_participants"
on public.poll_options
for select
using (
  exists (
    select 1
    from public.polls pl
    join public.participants p on p.project_id = pl.project_id
    where pl.id = poll_options.poll_id
      and p.user_id = auth.uid()
      and p.left_at is null
  )
);

create policy "poll_options_insert_participants"
on public.poll_options
for insert
with check (
  exists (
    select 1
    from public.polls pl
    join public.participants p on p.project_id = pl.project_id
    where pl.id = poll_options.poll_id
      and p.user_id = auth.uid()
      and p.left_at is null
  )
);

create policy "poll_votes_select_participants"
on public.poll_votes
for select
using (
  exists (
    select 1
    from public.polls pl
    join public.participants p on p.project_id = pl.project_id
    where pl.id = poll_votes.poll_id
      and p.user_id = auth.uid()
      and p.left_at is null
  )
);

create policy "poll_votes_insert_own"
on public.poll_votes
for insert
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.polls pl
    join public.participants p on p.project_id = pl.project_id
    where pl.id = poll_votes.poll_id
      and p.user_id = auth.uid()
      and p.left_at is null
  )
);

create policy "poll_votes_update_own"
on public.poll_votes
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "poll_votes_delete_own"
on public.poll_votes
for delete
using (user_id = auth.uid());
