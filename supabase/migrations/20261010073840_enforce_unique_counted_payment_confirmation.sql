-- Base contributions have exactly one counted confirmation per participant.
-- Extra and late-join obligations remain in their dedicated tables and are
-- intentionally outside this identity rule.
--
-- Deployment gate: fail without modifying data if historical counted
-- duplicates exist. They require a separate, explicitly approved data review.

do $$
begin
  if exists (
    select 1
    from public.payments
    where is_counted is true
    group by participant_id
    having count(*) > 1
  ) then
    raise exception using
      errcode = '23505',
      message = 'Duplicate counted base payment confirmations require review before this migration can be deployed';
  end if;
end
$$;

create unique index if not exists payments_one_counted_confirmation_per_participant_idx
  on public.payments (participant_id)
  where is_counted is true;
