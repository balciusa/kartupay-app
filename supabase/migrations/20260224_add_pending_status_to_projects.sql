alter table if exists public.projects
  add column if not exists started_collecting_at timestamptz;

alter table if exists public.projects
  alter column status set default 'pending';

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'projects_status_check'
      and conrelid = 'public.projects'::regclass
  ) then
    alter table public.projects
      drop constraint projects_status_check;
  end if;

  alter table public.projects
    add constraint projects_status_check
    check (status in ('pending', 'collecting', 'closed', 'cancelled', 'canceled'));
exception
  when undefined_table then
    null;
end
$$;
