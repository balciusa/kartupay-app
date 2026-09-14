alter table public.polls
add column if not exists extra_is_per_person boolean not null default true;
