alter table public.projects
  add column if not exists finance_mode text not null default 'managed';

update public.projects
set finance_mode = 'managed'
where finance_mode is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'projects_finance_mode_check'
      and conrelid = 'public.projects'::regclass
  ) then
    alter table public.projects
      add constraint projects_finance_mode_check
      check (finance_mode in ('none', 'managed'));
  end if;
end
$$;

comment on column public.projects.finance_mode is
  'Project-level financial capability. Supported values are none and managed; existing projects default to managed.';

create or replace function public.project_has_financial_activity(p_project_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  has_activity boolean := false;
  candidate_table text;
begin
  if to_regclass('public.payments') is not null then
    execute $query$
      select exists (
        select 1
        from public.payments payment
        join public.participants participant on participant.id = payment.participant_id
        where participant.project_id = $1
      )
    $query$ into has_activity using p_project_id;
    if has_activity then return true; end if;
  end if;

  if to_regclass('public.payment_signals') is not null then
    execute $query$
      select exists (
        select 1
        from public.payment_signals signal
        join public.participants participant on participant.id = signal.participant_id
        where participant.project_id = $1
      )
    $query$ into has_activity using p_project_id;
    if has_activity then return true; end if;
  end if;

  if to_regclass('public.late_join_transfers') is not null then
    execute 'select exists (select 1 from public.late_join_transfers where project_id = $1)'
      into has_activity using p_project_id;
    if has_activity then return true; end if;
  end if;

  if to_regclass('public.extra_payments') is not null then
    execute $query$
      select exists (
        select 1
        from public.extra_payments extra_payment
        join public.extras extra on extra.id = extra_payment.extra_id
        where extra.project_id = $1
      )
    $query$ into has_activity using p_project_id;
    if has_activity then return true; end if;
  end if;

  if to_regclass('public.participant_refund_requests') is not null then
    execute 'select exists (select 1 from public.participant_refund_requests where project_id = $1)'
      into has_activity using p_project_id;
    if has_activity then return true; end if;
  end if;

  foreach candidate_table in array array[
    'project_balances',
    'project_payouts',
    'project_financial_ledger',
    'financial_ledger_entries'
  ] loop
    if to_regclass('public.' || candidate_table) is not null
      and exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = candidate_table
          and column_name = 'project_id'
      ) then
      execute format('select exists (select 1 from public.%I where project_id = $1)', candidate_table)
        into has_activity using p_project_id;
      if has_activity then return true; end if;
    end if;
  end loop;

  return false;
end
$$;

create or replace function public.set_project_finance_mode(
  p_project_id uuid,
  p_finance_mode text
)
returns public.projects
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_project public.projects;
begin
  if p_finance_mode not in ('none', 'managed') then
    raise exception 'Invalid shared cost management option' using errcode = '22023';
  end if;

  select *
  into current_project
  from public.projects
  where id = p_project_id
  for update;

  if not found then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;

  if current_project.finance_mode = 'managed'
    and p_finance_mode = 'none'
    and public.project_has_financial_activity(p_project_id) then
    raise exception 'Financial management cannot be disabled because this project already has financial activity.'
      using errcode = 'P0001';
  end if;

  update public.projects
  set finance_mode = p_finance_mode
  where id = p_project_id
  returning * into current_project;

  return current_project;
end
$$;

revoke all on function public.project_has_financial_activity(uuid) from public, anon, authenticated;
revoke all on function public.set_project_finance_mode(uuid, text) from public, anon, authenticated;
grant execute on function public.project_has_financial_activity(uuid) to service_role;
grant execute on function public.set_project_finance_mode(uuid, text) to service_role;
