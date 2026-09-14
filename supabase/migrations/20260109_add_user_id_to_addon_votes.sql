alter table public.addon_votes
add column if not exists user_id uuid references public.users (id);

create index if not exists addon_votes_user_id_idx on public.addon_votes (user_id);
