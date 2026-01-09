alter table public.projects
add column if not exists total_is_per_person boolean not null default false;
