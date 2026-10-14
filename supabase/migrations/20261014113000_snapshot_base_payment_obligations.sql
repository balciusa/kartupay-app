-- Preserve the exact base obligation and recipient at manual confirmation time.
-- Existing NULL rows remain untouched because their historical amount or recipient
-- cannot be reconstructed safely from the current participant count.

alter table public.payments
  add column if not exists amount_cents integer,
  add column if not exists collector_participant_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.payments'::regclass
      and conname = 'payments_amount_cents_non_negative'
  ) then
    alter table public.payments
      add constraint payments_amount_cents_non_negative
      check (amount_cents is null or amount_cents >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.payments'::regclass
      and conname = 'payments_collector_participant_id_fkey'
  ) then
    alter table public.payments
      add constraint payments_collector_participant_id_fkey
      foreign key (collector_participant_id)
      references public.participants(id)
      on delete restrict;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.payments'::regclass
      and conname = 'payments_counted_snapshot_required'
  ) then
    alter table public.payments
      add constraint payments_counted_snapshot_required
      check (
        not is_counted
        or (amount_cents is not null and collector_participant_id is not null)
      ) not valid;
  end if;
end
$$;

create or replace function public.protect_counted_payment_snapshot()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.amount_cents is not null and new.amount_cents is distinct from old.amount_cents then
    raise exception 'counted payment amount snapshot is immutable';
  end if;
  if old.collector_participant_id is not null
     and new.collector_participant_id is distinct from old.collector_participant_id then
    raise exception 'counted payment recipient snapshot is immutable';
  end if;
  return new;
end
$$;

revoke all on function public.protect_counted_payment_snapshot() from public, anon, authenticated;
grant execute on function public.protect_counted_payment_snapshot() to service_role;

drop trigger if exists protect_counted_payment_snapshot on public.payments;
create trigger protect_counted_payment_snapshot
before update of amount_cents, collector_participant_id on public.payments
for each row execute function public.protect_counted_payment_snapshot();

create index if not exists payments_collector_participant_id_idx
  on public.payments (collector_participant_id)
  where is_counted = true;

comment on column public.payments.amount_cents is
  'Immutable base obligation in cents captured when a counted payment is confirmed. NULL denotes legacy unknown history.';

comment on column public.payments.collector_participant_id is
  'Participant who received the counted base payment. NULL denotes legacy unknown history.';
