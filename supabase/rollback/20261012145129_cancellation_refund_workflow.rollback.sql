begin;

-- Emergency containment only. Financial history is intentionally retained.
-- Rolling the schema backward would either delete refund records or collapse
-- distinct recipient obligations, so recovery uses a forward application fix.
drop policy if exists "participant_refund_requests_select_active_project"
  on public.participant_refund_requests;
revoke all privileges on table public.participant_refund_requests from anon, authenticated;
grant all privileges on table public.participant_refund_requests to service_role;

comment on table public.participant_refund_requests is
  'Refund workflow contained for emergency recovery; preserve rows and deploy a forward fix.';

commit;
