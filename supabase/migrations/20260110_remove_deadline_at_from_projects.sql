-- Remove unused deadline column from projects
alter table if exists public.projects
  drop column if exists deadline_at;