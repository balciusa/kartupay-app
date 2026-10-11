\set ON_ERROR_STOP on

-- Synthetic schema for isolated authorization tests. No Production rows are copied.
create table public.users (id uuid primary key, email text, display_name text);
create table public.projects (
  id uuid primary key, title text not null, is_public boolean not null default false,
  status text not null default 'pending', created_by uuid
);
create table public.participants (
  id uuid primary key, project_id uuid not null references public.projects(id),
  user_id uuid not null references public.users(id), role text not null default 'member', left_at timestamptz
);
alter table public.projects add column collector_participant_id uuid references public.participants(id);
create table public.messages (
  id uuid primary key, project_id uuid not null references public.projects(id),
  user_id uuid not null, author_user_id uuid not null, body text not null
);
create table public.payment_options (
  id uuid primary key, participant_id uuid not null references public.participants(id),
  type text not null, label text, value text not null
);
create table public.payments (
  id uuid primary key, participant_id uuid not null references public.participants(id),
  is_counted boolean not null default false, created_by uuid
);
create table public.payment_signals (
  id uuid primary key, participant_id uuid not null references public.participants(id), cleared_at timestamptz
);
create table public.late_join_transfers (
  id uuid primary key, project_id uuid not null references public.projects(id),
  from_participant_id uuid not null references public.participants(id),
  to_participant_id uuid not null references public.participants(id),
  expected_cents integer not null, received_at timestamptz, sender_marked_at timestamptz
);
create table public.extras (id uuid primary key, project_id uuid not null references public.projects(id));
create table public.extra_payments (
  id uuid primary key, extra_id uuid not null references public.extras(id),
  payer_participant_id uuid not null references public.participants(id)
);
create table public.join_requests (
  id uuid primary key, project_id uuid not null references public.projects(id),
  requester_user_id uuid not null references public.users(id), status text not null default 'pending'
);
create table public.project_invites (
  project_id uuid primary key references public.projects(id), invite_version integer not null default 1
);
create table public.user_payment_options (
  id uuid primary key, user_id uuid not null references public.users(id),
  type text not null, label text, value text not null
);

alter table public.users enable row level security;
alter table public.projects enable row level security;
alter table public.participants enable row level security;
alter table public.messages enable row level security;
alter table public.payment_options enable row level security;
alter table public.payments enable row level security;
alter table public.payment_signals enable row level security;
alter table public.late_join_transfers enable row level security;
alter table public.extras enable row level security;
alter table public.extra_payments enable row level security;
alter table public.join_requests enable row level security;
alter table public.project_invites enable row level security;
alter table public.user_payment_options enable row level security;

grant all privileges on table public.users, public.projects, public.participants,
  public.messages, public.payment_options, public.payments, public.payment_signals,
  public.late_join_transfers, public.extras, public.extra_payments,
  public.join_requests, public.project_invites, public.user_payment_options
to anon, authenticated, service_role;

create or replace function public.is_project_member(p_project_id uuid)
returns boolean language sql security definer set search_path = 'public'
as $$
  select exists (
    select 1 from public.participants participant
    where participant.project_id = p_project_id
      and participant.user_id = (select auth.uid())
  );
$$;

-- Representative permissive Production policies replaced by the migration.
create policy "proj_read" on public.projects for select to public using (true);
create policy "proj_write" on public.projects for insert to public with check ((select auth.uid()) = created_by);
create policy "proj_update" on public.projects for update to public using ((select auth.uid()) = created_by);
create policy "participants_read_any" on public.participants for select to authenticated using (true);
create policy "participants_insert_guard" on public.participants for insert to authenticated with check (true);
create policy "msg_select" on public.messages for select to public using (true);
create policy "payopt_read" on public.payment_options for select to public using (true);
create policy "pay_select" on public.payments for select to public using (true);
create policy "payments_insert_guard" on public.payments for insert to authenticated with check (true);
create policy "payment_signals_select" on public.payment_signals for select to authenticated using (true);
create policy "payment_signals_insert" on public.payment_signals for insert to authenticated with check (true);
create policy "late_join_transfers_read_for_members" on public.late_join_transfers for select to authenticated using (true);
create policy "late_join_sender_can_mark_paid" on public.late_join_transfers for update to authenticated using (true) with check (true);
create policy "extras_select_participants" on public.extras for select to authenticated
using (exists (
  select 1 from public.participants participant
  where participant.project_id = extras.project_id
    and participant.user_id = (select auth.uid())
    and participant.left_at is null
));
create policy "extra_payments_select_participants" on public.extra_payments for select to public using (true);
create policy "join_requests_insert_self" on public.join_requests for insert to authenticated with check (requester_user_id = (select auth.uid()));
create policy "join_requests_select_self" on public.join_requests for select to authenticated using (requester_user_id = (select auth.uid()));
create policy "users_select_display" on public.users for select to authenticated using (true);
create policy "users_update_own" on public.users for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "upo_select" on public.user_payment_options for select to public using ((select auth.uid()) = user_id);
create policy "upo_write" on public.user_payment_options for insert to public with check ((select auth.uid()) = user_id);
create policy "upo_update" on public.user_payment_options for update to public using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "upo_delete" on public.user_payment_options for delete to public using ((select auth.uid()) = user_id);

insert into public.users (id, email, display_name) values
  ('00000000-0000-0000-0000-000000000001', 'organizer@example.invalid', 'Organizer'),
  ('00000000-0000-0000-0000-000000000002', 'member@example.invalid', 'Member'),
  ('00000000-0000-0000-0000-000000000003', 'unrelated@example.invalid', 'Unrelated'),
  ('00000000-0000-0000-0000-000000000004', 'former@example.invalid', 'Former'),
  ('00000000-0000-0000-0000-000000000005', 'collector@example.invalid', 'Collector');
insert into public.projects (id, title, is_public, status, created_by) values
  ('10000000-0000-0000-0000-000000000001', 'Public fixture', true, 'pending', '00000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000002', 'Private fixture', false, 'collecting', '00000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000003', 'Unrelated private fixture', false, 'pending', '00000000-0000-0000-0000-000000000003');
insert into public.participants (id, project_id, user_id, role, left_at) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'organizer', null),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'member', null),
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000004', 'member', now()),
  ('20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000005', 'member', null),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000003', 'organizer', null);
insert into public.messages values ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'Synthetic message');
insert into public.payment_options values ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000005', 'iban', 'Collector', 'DE89370400440532013000');
insert into public.payments values ('50000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', true, '00000000-0000-0000-0000-000000000001');
insert into public.payment_signals values ('60000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', null);
insert into public.late_join_transfers values ('70000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000005', 1000, null, null);
insert into public.extras values ('80000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002');
insert into public.extra_payments values ('90000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002');
insert into public.join_requests values ('a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003', 'pending');
insert into public.project_invites values ('10000000-0000-0000-0000-000000000002', 1);
insert into public.user_payment_options values ('b0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'iban', 'Member', 'FR1420041010050500013M02606');
