alter table public.messages
add column if not exists parent_id uuid references public.messages (id) on delete cascade;

create index if not exists messages_parent_id_idx on public.messages (parent_id);
