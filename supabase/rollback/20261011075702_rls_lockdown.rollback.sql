-- Emergency rollback for 20261011075702_rls_lockdown.sql.
-- WARNING: this restores the vulnerable Production policy/grant state captured
-- before the migration. Prefer a forward fix. Run only with explicit approval.
begin;

drop policy if exists "projects_select_public" on public.projects;
drop policy if exists "projects_select_active_members" on public.projects;
create policy "proj_read" on public.projects for select to public using (true);
create policy "proj_update" on public.projects for update to public using ((select auth.uid()) = created_by);
create policy "proj_write" on public.projects for insert to public with check ((select auth.uid()) = created_by);
create policy "projects_update_collector" on public.projects for update to public
using (exists (
  select 1 from public.participants participant
  where participant.project_id = projects.id
    and participant.user_id = (select auth.uid())
    and participant.role = 'organizer'
    and participant.left_at is null
))
with check (
  collector_participant_id is null
  or exists (
    select 1 from public.participants collector
    where collector.id = projects.collector_participant_id
      and collector.project_id = projects.id
      and collector.left_at is null
  )
);

drop policy if exists "participants_select_active_project" on public.participants;
create policy "participants: self-update left_at" on public.participants for update to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "participants_insert_guard" on public.participants for insert to authenticated
with check (exists (
  select 1 from public.projects project
  where project.id = participants.project_id and project.status <> 'canceled'
));
create policy "participants_read_any" on public.participants for select to authenticated using (true);
create policy "participants_select_own" on public.participants for select to authenticated using (user_id = (select auth.uid()));
create policy "participants_select_same_project" on public.participants for select to authenticated
using (public.is_project_member(project_id));

drop policy if exists "messages_select_active_project" on public.messages;
create policy "messages_insert" on public.messages for insert to authenticated
with check (exists (
  select 1 from public.participants participant
  where participant.project_id = messages.project_id
    and participant.user_id = (select auth.uid())
    and participant.left_at is null
));
create policy "messages_read" on public.messages for select to authenticated
using (exists (
  select 1 from public.participants participant
  where participant.project_id = messages.project_id
    and participant.user_id = (select auth.uid())
    and participant.left_at is null
));
create policy "messages_select" on public.messages for select to authenticated
using (exists (
  select 1 from public.participants participant
  where participant.project_id = messages.project_id
    and participant.user_id = (select auth.uid())
    and participant.left_at is null
));
create policy "msg_insert" on public.messages for insert to public
with check (exists (
  select 1 from public.participants participant
  where participant.project_id = messages.project_id
    and participant.user_id = (select auth.uid())
));
create policy "msg_select" on public.messages for select to public using (true);

drop policy if exists "payment_options_select_active_project" on public.payment_options;
create policy "payment_options_read_for_members" on public.payment_options for select to authenticated
using (exists (
  select 1 from public.participants target
  where target.id = payment_options.participant_id
    and exists (
      select 1 from public.participants viewer
      where viewer.project_id = target.project_id and viewer.user_id = (select auth.uid())
    )
));
create policy "payment_options_read_same_project" on public.payment_options for select to authenticated
using (exists (select 1 from public.participants target where target.id = payment_options.participant_id));
create policy "payopt_read" on public.payment_options for select to public using (true);
create policy "payopts_insert" on public.payment_options for insert to public
with check (exists (
  select 1 from public.participants participant
  where participant.id = payment_options.participant_id and participant.user_id = (select auth.uid())
));
create policy "payopts_select" on public.payment_options for select to public using (true);
create policy "payopts_update" on public.payment_options for update to public
using (exists (
  select 1 from public.participants participant
  where participant.id = payment_options.participant_id and participant.user_id = (select auth.uid())
));

drop policy if exists "payments_select_active_project" on public.payments;
create policy "pay_insert" on public.payments for insert to public
with check (exists (
  select 1
  from public.participants participant
  join public.projects project on project.id = participant.project_id
  where participant.id = payments.participant_id
    and (participant.user_id = (select auth.uid()) or project.created_by = (select auth.uid()))
));
create policy "pay_select" on public.payments for select to public using (true);
create policy "payments_insert_guard" on public.payments for insert to authenticated
with check (exists (
  select 1
  from public.participants participant
  join public.projects project on project.id = participant.project_id
  where participant.id = payments.participant_id and project.status <> 'canceled'
));
create policy "payments_read_for_members" on public.payments for select to authenticated
using (exists (
  select 1 from public.participants target
  where target.id = payments.participant_id
    and exists (
      select 1 from public.participants viewer
      where viewer.project_id = target.project_id and viewer.user_id = (select auth.uid())
    )
));

drop policy if exists "payment_signals_select_active_project" on public.payment_signals;
create policy "payment_signals_insert" on public.payment_signals for insert to authenticated
with check (exists (
  select 1 from public.participants participant
  where participant.id = payment_signals.participant_id
    and participant.user_id = (select auth.uid())
    and participant.left_at is null
));
create policy "payment_signals_select" on public.payment_signals for select to authenticated
using (exists (
  select 1 from public.participants participant
  where participant.id = payment_signals.participant_id
    and participant.left_at is null
    and (
      participant.user_id = (select auth.uid())
      or (
        participant.role = 'organizer'
        and exists (
          select 1 from public.participants viewer
          where viewer.project_id = participant.project_id
            and viewer.user_id = (select auth.uid())
            and viewer.left_at is null
        )
      )
    )
));
create policy "payment_signals_update" on public.payment_signals for update to authenticated
using (exists (
  select 1
  from public.participants organizer
  join public.participants target on target.id = payment_signals.participant_id
  where organizer.user_id = (select auth.uid())
    and organizer.project_id = target.project_id
    and organizer.role = 'organizer'
    and organizer.left_at is null
)) with check (true);

drop policy if exists "late_join_transfers_select_active_project" on public.late_join_transfers;
create policy "late_join_recipient_can_confirm" on public.late_join_transfers for update to authenticated
using (exists (
  select 1 from public.participants participant
  where participant.id = late_join_transfers.to_participant_id and participant.user_id = (select auth.uid())
)) with check (exists (
  select 1 from public.participants participant
  where participant.id = late_join_transfers.to_participant_id and participant.user_id = (select auth.uid())
));
create policy "late_join_sender_can_mark_paid" on public.late_join_transfers for update to authenticated
using (exists (
  select 1 from public.participants participant
  where participant.id = late_join_transfers.from_participant_id and participant.user_id = (select auth.uid())
)) with check (exists (
  select 1 from public.participants participant
  where participant.id = late_join_transfers.from_participant_id and participant.user_id = (select auth.uid())
));
create policy "late_join_transfers_read_for_members" on public.late_join_transfers for select to authenticated
using (exists (
  select 1 from public.participants participant
  where participant.project_id = late_join_transfers.project_id and participant.user_id = (select auth.uid())
));

drop policy if exists "extra_payments_select_active_project" on public.extra_payments;
create policy "extra_payments_select_participants" on public.extra_payments for select to public
using (exists (
  select 1
  from public.extras extra
  join public.participants participant on participant.project_id = extra.project_id
  where extra.id = extra_payments.extra_id
    and participant.user_id = (select auth.uid())
    and participant.left_at is null
));

drop policy if exists "join_requests_select_self" on public.join_requests;
drop policy if exists "join_requests_select_active_organizer" on public.join_requests;
create policy "join_requests_insert_self" on public.join_requests for insert to authenticated with check (requester_user_id = (select auth.uid()));
create policy "join_requests_select_for_organizer" on public.join_requests for select to authenticated
using (status = 'pending' and exists (
  select 1 from public.participants participant
  where participant.project_id = join_requests.project_id
    and participant.user_id = (select auth.uid())
    and participant.role = 'organizer'
));
create policy "join_requests_select_self" on public.join_requests for select to authenticated using (requester_user_id = (select auth.uid()));
create policy "jr_delete_organizer" on public.join_requests for delete to authenticated
using (exists (
  select 1 from public.participants participant
  where participant.project_id = join_requests.project_id
    and participant.user_id = (select auth.uid())
    and participant.role = 'organizer'
));
create policy "jr_insert_mine" on public.join_requests for insert to authenticated
with check (requester_user_id = (select auth.uid()) and status = 'pending');
create policy "jr_insert_own" on public.join_requests for insert to authenticated with check (requester_user_id = (select auth.uid()));
create policy "jr_select_mine" on public.join_requests for select to authenticated using (requester_user_id = (select auth.uid()));
create policy "jr_select_organizer" on public.join_requests for select to authenticated
using (exists (
  select 1 from public.participants participant
  where participant.project_id = join_requests.project_id
    and participant.user_id = (select auth.uid())
    and participant.role = 'organizer'
    and participant.left_at is null
));
create policy "jr_select_own" on public.join_requests for select to authenticated using (requester_user_id = (select auth.uid()));
create policy "jr_update_organizer" on public.join_requests for update to authenticated
using (exists (
  select 1 from public.participants participant
  where participant.project_id = join_requests.project_id
    and participant.user_id = (select auth.uid())
    and participant.role = 'organizer'
    and participant.left_at is null
)) with check (true);

drop policy if exists "users_select_self_or_active_project" on public.users;
drop policy if exists "users_update_own_display_name" on public.users;
create policy "users_select_display" on public.users for select to authenticated using (true);
create policy "users_select_minimal" on public.users for select to authenticated using (true);
create policy "users_update_own" on public.users for update to authenticated
using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "users_update_own_display_name" on public.users for update to authenticated
using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy if exists "user_payment_options_select_own" on public.user_payment_options;
drop policy if exists "user_payment_options_insert_own" on public.user_payment_options;
drop policy if exists "user_payment_options_update_own" on public.user_payment_options;
drop policy if exists "user_payment_options_delete_own" on public.user_payment_options;
create policy "upo_delete" on public.user_payment_options for delete to public using ((select auth.uid()) = user_id);
create policy "upo_select" on public.user_payment_options for select to public using ((select auth.uid()) = user_id);
create policy "upo_update" on public.user_payment_options for update to public
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "upo_write" on public.user_payment_options for insert to public with check ((select auth.uid()) = user_id);

grant all privileges on table public.projects, public.participants, public.messages,
  public.payment_options, public.payments, public.payment_signals,
  public.late_join_transfers, public.extra_payments, public.join_requests,
  public.project_invites, public.users, public.user_payment_options
to anon, authenticated;

drop function if exists private.kartupay_shares_active_project_with_user(uuid);
drop function if exists private.kartupay_can_read_participant_finance(uuid);
drop function if exists private.kartupay_is_active_project_organizer(uuid);
drop function if exists private.kartupay_is_active_project_member(uuid);
revoke usage on schema private from authenticated, service_role;
drop schema if exists private;

commit;
