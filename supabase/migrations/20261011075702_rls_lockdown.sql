begin;

-- Keep recursive membership checks out of the exposed public schema and bypass
-- participants RLS only for the narrow authorization predicates below.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create or replace function private.kartupay_is_active_project_member(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.participants participant
    where participant.project_id = p_project_id
      and participant.user_id = (select auth.uid())
      and participant.left_at is null
  );
$$;

create or replace function private.kartupay_is_active_project_organizer(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.participants participant
    where participant.project_id = p_project_id
      and participant.user_id = (select auth.uid())
      and participant.role = 'organizer'
      and participant.left_at is null
  );
$$;

create or replace function private.kartupay_can_read_participant_finance(p_participant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.participants target
    join public.participants viewer
      on viewer.project_id = target.project_id
    where target.id = p_participant_id
      and viewer.user_id = (select auth.uid())
      and viewer.left_at is null
  );
$$;

create or replace function private.kartupay_shares_active_project_with_user(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.participants viewer
    join public.participants target
      on target.project_id = viewer.project_id
     and target.user_id = p_user_id
     and target.left_at is null
    where viewer.user_id = (select auth.uid())
      and viewer.left_at is null
  );
$$;

revoke all on function private.kartupay_is_active_project_member(uuid) from public;
revoke all on function private.kartupay_is_active_project_organizer(uuid) from public;
revoke all on function private.kartupay_can_read_participant_finance(uuid) from public;
revoke all on function private.kartupay_shares_active_project_with_user(uuid) from public;
grant execute on function private.kartupay_is_active_project_member(uuid) to authenticated, service_role;
grant execute on function private.kartupay_is_active_project_organizer(uuid) to authenticated, service_role;
grant execute on function private.kartupay_can_read_participant_finance(uuid) to authenticated, service_role;
grant execute on function private.kartupay_shares_active_project_with_user(uuid) to authenticated, service_role;

-- Projects: anonymous discovery is public-only. Private rows require a current
-- active membership. All mutations continue through checked server actions.
drop policy if exists "proj_read" on public.projects;
drop policy if exists "proj_write" on public.projects;
drop policy if exists "proj_update" on public.projects;
drop policy if exists "projects_update_collector" on public.projects;
drop policy if exists "projects_select_public" on public.projects;
drop policy if exists "projects_select_active_members" on public.projects;

create policy "projects_select_public"
on public.projects for select
to anon, authenticated
using (is_public is true);

create policy "projects_select_active_members"
on public.projects for select
to authenticated
using (private.kartupay_is_active_project_member(id));

revoke all privileges on table public.projects from anon, authenticated;
grant select on table public.projects to anon, authenticated;

-- Participants: direct writes allowed members to choose organizer and change
-- authorization-bearing columns. Server actions already perform all writes.
drop policy if exists "participants: self-update left_at" on public.participants;
drop policy if exists "participants_insert_guard" on public.participants;
drop policy if exists "participants_read_any" on public.participants;
drop policy if exists "participants_select_own" on public.participants;
drop policy if exists "participants_select_same_project" on public.participants;
drop policy if exists "participants_select_active_project" on public.participants;

create policy "participants_select_active_project"
on public.participants for select
to authenticated
using (private.kartupay_is_active_project_member(project_id));

revoke all privileges on table public.participants from anon, authenticated;
grant select on table public.participants to authenticated;

-- Messages are project-private and immutable through the Data API. The chat
-- server action verifies membership and writes with the service role.
drop policy if exists "messages_insert" on public.messages;
drop policy if exists "messages_read" on public.messages;
drop policy if exists "messages_select" on public.messages;
drop policy if exists "msg_insert" on public.messages;
drop policy if exists "msg_select" on public.messages;
drop policy if exists "messages_select_active_project" on public.messages;

create policy "messages_select_active_project"
on public.messages for select
to authenticated
using (private.kartupay_is_active_project_member(project_id));

revoke all privileges on table public.messages from anon, authenticated;
grant select on table public.messages to authenticated;

-- Project payment destinations are readable only by active project members.
-- Validation and mutations remain in service-role server actions.
drop policy if exists "payment_options_read_for_members" on public.payment_options;
drop policy if exists "payment_options_read_same_project" on public.payment_options;
drop policy if exists "payopt_read" on public.payment_options;
drop policy if exists "payopts_insert" on public.payment_options;
drop policy if exists "payopts_select" on public.payment_options;
drop policy if exists "payopts_update" on public.payment_options;
drop policy if exists "payment_options_select_active_project" on public.payment_options;

create policy "payment_options_select_active_project"
on public.payment_options for select
to authenticated
using (private.kartupay_can_read_participant_finance(participant_id));

revoke all privileges on table public.payment_options from anon, authenticated;
grant select on table public.payment_options to authenticated;

-- Counted payments are manual ledger state, not a client-writable resource.
drop policy if exists "pay_insert" on public.payments;
drop policy if exists "pay_select" on public.payments;
drop policy if exists "payments_insert_guard" on public.payments;
drop policy if exists "payments_read_for_members" on public.payments;
drop policy if exists "payments_select_active_project" on public.payments;

create policy "payments_select_active_project"
on public.payments for select
to authenticated
using (private.kartupay_can_read_participant_finance(participant_id));

revoke all privileges on table public.payments from anon, authenticated;
grant select on table public.payments to authenticated;

-- Related manual payment state follows the same project boundary and remains
-- writable only through authorized service-role actions.
drop policy if exists "payment_signals_insert" on public.payment_signals;
drop policy if exists "payment_signals_select" on public.payment_signals;
drop policy if exists "payment_signals_update" on public.payment_signals;
drop policy if exists "payment_signals_select_active_project" on public.payment_signals;

create policy "payment_signals_select_active_project"
on public.payment_signals for select
to authenticated
using (private.kartupay_can_read_participant_finance(participant_id));

revoke all privileges on table public.payment_signals from anon, authenticated;
grant select on table public.payment_signals to authenticated;

drop policy if exists "late_join_recipient_can_confirm" on public.late_join_transfers;
drop policy if exists "late_join_sender_can_mark_paid" on public.late_join_transfers;
drop policy if exists "late_join_transfers_read_for_members" on public.late_join_transfers;
drop policy if exists "late_join_transfers_select_active_project" on public.late_join_transfers;

create policy "late_join_transfers_select_active_project"
on public.late_join_transfers for select
to authenticated
using (private.kartupay_is_active_project_member(project_id));

revoke all privileges on table public.late_join_transfers from anon, authenticated;
grant select on table public.late_join_transfers to authenticated;

drop policy if exists "extra_payments_select_participants" on public.extra_payments;
drop policy if exists "extra_payments_select_active_project" on public.extra_payments;

create policy "extra_payments_select_active_project"
on public.extra_payments for select
to authenticated
using (
  exists (
    select 1
    from public.extras extra
    where extra.id = extra_payments.extra_id
      and private.kartupay_is_active_project_member(extra.project_id)
  )
);

revoke all privileges on table public.extra_payments from anon, authenticated;
grant select on table public.extra_payments to authenticated;

-- Join requests are created and decided by server actions so project status,
-- privacy, authorization, and capacity checks cannot be bypassed.
drop policy if exists "join_requests_insert_self" on public.join_requests;
drop policy if exists "join_requests_select_for_organizer" on public.join_requests;
drop policy if exists "join_requests_select_self" on public.join_requests;
drop policy if exists "jr_delete_organizer" on public.join_requests;
drop policy if exists "jr_insert_mine" on public.join_requests;
drop policy if exists "jr_insert_own" on public.join_requests;
drop policy if exists "jr_select_mine" on public.join_requests;
drop policy if exists "jr_select_organizer" on public.join_requests;
drop policy if exists "jr_select_own" on public.join_requests;
drop policy if exists "jr_update_organizer" on public.join_requests;
drop policy if exists "join_requests_select_self" on public.join_requests;
drop policy if exists "join_requests_select_active_organizer" on public.join_requests;

create policy "join_requests_select_self"
on public.join_requests for select
to authenticated
using (requester_user_id = (select auth.uid()));

create policy "join_requests_select_active_organizer"
on public.join_requests for select
to authenticated
using (private.kartupay_is_active_project_organizer(project_id));

revoke all privileges on table public.join_requests from anon, authenticated;
grant select on table public.join_requests to authenticated;

-- Invite versions are internal server state. A shared project URL can load only
-- the deliberately limited preview selected by the application server.
revoke all privileges on table public.project_invites from anon, authenticated;

-- User profiles are visible to the user and current co-participants only.
drop policy if exists "users_select_display" on public.users;
drop policy if exists "users_select_minimal" on public.users;
drop policy if exists "users_update_own" on public.users;
drop policy if exists "users_update_own_display_name" on public.users;
drop policy if exists "users_select_self_or_active_project" on public.users;

create policy "users_select_self_or_active_project"
on public.users for select
to authenticated
using (
  id = (select auth.uid())
  or private.kartupay_shares_active_project_with_user(id)
);

create policy "users_update_own_display_name"
on public.users for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

revoke all privileges on table public.users from anon, authenticated;
grant select on table public.users to authenticated;
grant update (display_name) on table public.users to authenticated;

-- Personal payment recipients remain owner-only for compatibility with profile
-- management; project copies are protected by payment_options policies above.
drop policy if exists "upo_delete" on public.user_payment_options;
drop policy if exists "upo_select" on public.user_payment_options;
drop policy if exists "upo_update" on public.user_payment_options;
drop policy if exists "upo_write" on public.user_payment_options;

create policy "user_payment_options_select_own"
on public.user_payment_options for select
to authenticated
using (user_id = (select auth.uid()));

create policy "user_payment_options_insert_own"
on public.user_payment_options for insert
to authenticated
with check (user_id = (select auth.uid()));

create policy "user_payment_options_update_own"
on public.user_payment_options for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "user_payment_options_delete_own"
on public.user_payment_options for delete
to authenticated
using (user_id = (select auth.uid()));

revoke all privileges on table public.user_payment_options from anon, authenticated;
grant select, insert, update, delete on table public.user_payment_options to authenticated;

commit;
