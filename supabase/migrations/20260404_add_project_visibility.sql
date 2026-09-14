alter table if exists public.projects
add column if not exists is_public boolean not null default false;

create index if not exists projects_is_public_idx
on public.projects (is_public);
