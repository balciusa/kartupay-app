\set ON_ERROR_STOP on
begin;

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$ declare n integer; begin
  select count(*) into n from public.projects;
  if n <> 1 then raise exception 'anon project count: expected 1, got %', n; end if;
  if exists (select 1 from public.projects where is_public is false) then raise exception 'anon read private project'; end if;
  if has_table_privilege('anon', 'public.messages', 'select') then raise exception 'anon retained message privilege'; end if;
  if has_table_privilege('anon', 'public.payment_options', 'select') then raise exception 'anon retained payment destination privilege'; end if;
  if has_table_privilege('anon', 'public.payments', 'select') then raise exception 'anon retained payment privilege'; end if;
  if has_table_privilege('anon', 'public.addons', 'select') then raise exception 'anon retained add-on privilege'; end if;
  if has_table_privilege('anon', 'public.addon_votes', 'select') then raise exception 'anon retained add-on vote privilege'; end if;
  if has_table_privilege('anon', 'public.audit_logs', 'select') then raise exception 'anon retained audit read privilege'; end if;
  if has_table_privilege('anon', 'public.audit_logs', 'insert,update,delete,truncate') then raise exception 'anon retained audit tampering privilege'; end if;
end $$;
do $$ begin
  begin
    insert into public.audit_logs (action) values ('anon.tamper');
    raise exception 'anon audit insert unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
  begin
    update public.audit_logs set action = 'anon.tamper';
    raise exception 'anon audit update unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.audit_logs;
    raise exception 'anon audit delete unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
  begin
    truncate public.audit_logs;
    raise exception 'anon audit truncate unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
do $$ begin
  if (select count(*) from public.projects) <> 2 then raise exception 'unrelated user project scope failed'; end if;
  if exists (select 1 from public.projects where id = '10000000-0000-0000-0000-000000000002') then raise exception 'unrelated user read target private project'; end if;
  if exists (select 1 from public.participants where project_id = '10000000-0000-0000-0000-000000000002') then raise exception 'unrelated user read private participants'; end if;
  if exists (select 1 from public.messages) then raise exception 'unrelated user read messages'; end if;
  if exists (select 1 from public.payment_options) then raise exception 'unrelated user read payment destinations'; end if;
  if exists (select 1 from public.payments) then raise exception 'unrelated user read payments'; end if;
  if exists (select 1 from public.addons where project_id = '10000000-0000-0000-0000-000000000002') then raise exception 'unrelated user read target private add-on'; end if;
  if (select count(*) from public.addons) <> 1 then raise exception 'unrelated user add-on scope failed'; end if;
  if (select count(*) from public.addon_votes) <> 1 then raise exception 'unrelated user add-on vote scope failed'; end if;
  if has_table_privilege('authenticated', 'public.audit_logs', 'select,insert,update,delete,truncate') then raise exception 'authenticated retained audit privilege'; end if;
  if (select count(*) from public.users) <> 1 then raise exception 'unrelated user profile scope failed'; end if;
end $$;
do $$ begin
  begin
    insert into public.participants (id, project_id, user_id, role) values ('c0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003', 'organizer');
    raise exception 'direct organizer escalation unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.payments (id, participant_id, is_counted, created_by) values ('c0000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', true, '00000000-0000-0000-0000-000000000003');
    raise exception 'unauthorized counted payment unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
  begin
    update public.late_join_transfers set received_at = now();
    raise exception 'unauthorized transfer confirmation unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.join_requests (id, project_id, requester_user_id, status) values ('c0000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003', 'approved');
    raise exception 'direct join approval unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.addons (id, project_id, title, extra_cents, required_votes) values ('c1000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 'Unauthorized', 1, 1);
    raise exception 'direct add-on insert unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.addon_votes (id, addon_id, user_id) values ('c2000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003');
    raise exception 'direct add-on vote unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.audit_logs (action) values ('authenticated.tamper');
    raise exception 'authenticated audit insert unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
  begin
    update public.audit_logs set action = 'authenticated.tamper';
    raise exception 'authenticated audit update unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.audit_logs;
    raise exception 'authenticated audit delete unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
  begin
    truncate public.audit_logs;
    raise exception 'authenticated audit truncate unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
do $$ begin
  if (select count(*) from public.projects) <> 2 then raise exception 'member project scope failed'; end if;
  if (select count(*) from public.participants where project_id = '10000000-0000-0000-0000-000000000002') <> 4 then raise exception 'member participant scope failed'; end if;
  if (select count(*) from public.messages) <> 1 then raise exception 'member message scope failed'; end if;
  if (select count(*) from public.payment_options) <> 1 then raise exception 'member payment destination scope failed'; end if;
  if (select count(*) from public.payments) <> 1 then raise exception 'member payment scope failed'; end if;
  if (select count(*) from public.payment_signals) <> 1 then raise exception 'member payment signal scope failed'; end if;
  if (select count(*) from public.late_join_transfers) <> 1 then raise exception 'member late-transfer scope failed'; end if;
  if (select count(*) from public.extra_payments) <> 1 then raise exception 'member extra-payment scope failed'; end if;
  if (select count(*) from public.addons) <> 1 then raise exception 'member add-on scope failed'; end if;
  if (select count(*) from public.addon_votes) <> 1 then raise exception 'member add-on vote scope failed'; end if;
  if (select count(*) from public.users) <> 3 then raise exception 'member co-participant profile scope failed'; end if;
  if (select count(*) from public.user_payment_options) <> 1 then raise exception 'member personal recipient scope failed'; end if;
end $$;
insert into public.user_payment_options (id, user_id, type, label, value) values ('b0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'iban', 'Member backup', 'GB29NWBK60161331926819');
update public.users set display_name = 'Member Updated' where id = '00000000-0000-0000-0000-000000000002';
do $$ begin
  begin
    update public.users set email = 'changed@example.invalid' where id = '00000000-0000-0000-0000-000000000002';
    raise exception 'email update unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.addon_votes (id, addon_id, user_id) values ('c2000000-0000-0000-0000-000000000002', '81000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002');
    raise exception 'member direct add-on vote unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
do $$ begin
  if (select count(*) from public.join_requests) <> 1 then raise exception 'organizer cannot read project join requests'; end if;
  if (select count(*) from public.addons) <> 1 then raise exception 'organizer add-on scope failed'; end if;
  if (select count(*) from public.addon_votes) <> 1 then raise exception 'organizer add-on vote scope failed'; end if;
  begin
    update public.projects set status = 'closed' where id = '10000000-0000-0000-0000-000000000002';
    raise exception 'direct organizer project update unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.addons (id, project_id, title, extra_cents, required_votes) values ('c1000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'Organizer direct write', 1, 1);
    raise exception 'organizer direct add-on insert unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', true);
do $$ begin
  if (select count(*) from public.payment_options) <> 1 then raise exception 'collector cannot read project destinations'; end if;
  if (select count(*) from public.addons) <> 1 then raise exception 'collector add-on scope failed'; end if;
  if (select count(*) from public.addon_votes) <> 1 then raise exception 'collector add-on vote scope failed'; end if;
  begin
    update public.payments set is_counted = false;
    raise exception 'collector direct payment update unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.addons;
    raise exception 'collector direct add-on delete unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
do $$ begin
  if (select count(*) from public.projects) <> 1 then raise exception 'former member retained private project access'; end if;
  if exists (select 1 from public.participants) then raise exception 'former member retained participant access'; end if;
  if exists (select 1 from public.messages) then raise exception 'former member retained message access'; end if;
  if exists (select 1 from public.payment_options) then raise exception 'former member retained destination access'; end if;
  if exists (select 1 from public.payments) then raise exception 'former member retained payment access'; end if;
  if exists (select 1 from public.addons) then raise exception 'former member retained add-on access'; end if;
  if exists (select 1 from public.addon_votes) then raise exception 'former member retained add-on vote access'; end if;
  if (select count(*) from public.users) <> 1 then raise exception 'former member own-profile scope failed'; end if;
end $$;
do $$ begin
  begin
    insert into public.audit_logs (action) values ('former.tamper');
    raise exception 'former member audit insert unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

set local role service_role;
do $$ begin
  if (select count(*) from public.projects) <> 3 then raise exception 'service role cannot read all projects'; end if;
  if (select count(*) from public.addons) <> 3 then raise exception 'service role cannot read all add-ons'; end if;
  if (select count(*) from public.addon_votes) <> 2 then raise exception 'service role cannot read all add-on votes'; end if;
  if (select count(*) from public.audit_logs) <> 1 then raise exception 'service role cannot read audit logs'; end if;
end $$;
insert into public.participants (id, project_id, user_id, role) values ('c0000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000002', 'member');
insert into public.payments (id, participant_id, is_counted, created_by) values ('c0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000004', true, '00000000-0000-0000-0000-000000000001');
insert into public.addons (id, project_id, title, extra_cents, required_votes) values ('c1000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'Service add-on', 2500, 2);
insert into public.addon_votes (id, addon_id, user_id) values ('c2000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000002');
insert into public.audit_logs (id, project_id, actor_id, action, details) values ('c3000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'service.created', '{}');
update public.audit_logs set details = '{"verified":true}' where id = 'c3000000-0000-0000-0000-000000000001';
delete from public.audit_logs where id = 'c3000000-0000-0000-0000-000000000001';
reset role;

rollback;
\echo 'RLS lockdown authorization matrix: PASS'
