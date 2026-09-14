alter table if exists public.projects
  add column if not exists bundle_size integer,
  add column if not exists bundle_pay_for integer;

alter table if exists public.projects
  drop constraint if exists projects_bundle_pricing_check;

alter table if exists public.projects
  add constraint projects_bundle_pricing_check
  check (
    (
      bundle_size is null
      and bundle_pay_for is null
    )
    or (
      total_is_per_person = true
      and bundle_size is not null
      and bundle_pay_for is not null
      and bundle_size >= 2
      and bundle_pay_for >= 1
      and bundle_pay_for < bundle_size
    )
  );
