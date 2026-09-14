create table if not exists public.chat_reads (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

alter table public.chat_reads enable row level security;

create policy "chat_reads_select_own"
on public.chat_reads
for select
using (
  auth.uid() = user_id
  and exists (
    select 1
    from public.participants p
    where p.project_id = chat_reads.project_id
      and p.user_id = auth.uid()
      and p.left_at is null
  )
);

create policy "chat_reads_insert_own"
on public.chat_reads
for insert
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.participants p
    where p.project_id = chat_reads.project_id
      and p.user_id = auth.uid()
      and p.left_at is null
  )
);

create policy "chat_reads_update_own"
on public.chat_reads
for update
using (
  auth.uid() = user_id
  and exists (
    select 1
    from public.participants p
    where p.project_id = chat_reads.project_id
      and p.user_id = auth.uid()
      and p.left_at is null
  )
)
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.participants p
    where p.project_id = chat_reads.project_id
      and p.user_id = auth.uid()
      and p.left_at is null
  )
);
