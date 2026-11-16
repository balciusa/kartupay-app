
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE TABLE public.projects(id uuid primary key,status text not null, canceled_at timestamptz,finance_mode text,is_public boolean,collector_participant_id uuid,max_participants integer,finalized_at timestamptz,total_cents integer,total_is_per_person boolean);
CREATE TABLE public.participants(id uuid primary key default gen_random_uuid(),project_id uuid references public.projects(id),user_id uuid,role text,left_at timestamptz,joined_at timestamptz default clock_timestamp(),attendance_status text default 'confirmed',unique(project_id,user_id));
CREATE TABLE public.join_requests(id uuid primary key,project_id uuid references public.projects(id),requester_user_id uuid,status text,approved_by uuid,approved_at timestamptz,participant_id uuid);
CREATE TABLE public.user_payment_options(id uuid primary key default gen_random_uuid(),user_id uuid not null,type text not null,label text,value text not null,priority integer,is_active boolean not null default true);
CREATE TABLE public.payment_options(id uuid primary key default gen_random_uuid(),participant_id uuid references public.participants(id),type text,label text,value text,priority integer,is_active boolean);
CREATE TABLE public.payments(id uuid primary key default gen_random_uuid(),participant_id uuid references public.participants(id),is_counted boolean);
CREATE TABLE public.late_join_transfers(id uuid primary key default gen_random_uuid(),project_id uuid references public.projects(id),from_participant_id uuid references public.participants(id),to_participant_id uuid references public.participants(id),expected_cents integer,unique(project_id,from_participant_id,to_participant_id));
CREATE TABLE public.activity_logs(id uuid primary key default gen_random_uuid(),project_id uuid references public.projects(id),entry_type text,actor_user_id uuid,actor_participant_id uuid,target_user_id uuid,target_participant_id uuid,join_request_id uuid,metadata jsonb not null default '{}'::jsonb);
INSERT INTO public.projects(id,status,finance_mode,is_public,max_participants,total_cents,total_is_per_person) VALUES
('11111111-1111-4111-8111-111111111111','pending','none',true,2,0,false),
('22222222-2222-4222-8222-222222222222','collecting','managed',false,2,10000,false),
('33333333-3333-4333-8333-333333333333','collecting','managed',false,2,10000,false);
INSERT INTO public.participants(id,project_id,user_id,role) VALUES
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','organizer'),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','organizer'),
('cccccccc-cccc-4ccc-8ccc-cccccccccccc','33333333-3333-4333-8333-333333333333','cccccccc-cccc-4ccc-8ccc-cccccccccccc','organizer');
INSERT INTO public.join_requests(id,project_id,requester_user_id,status) VALUES
('22222222-0000-4000-8000-000000000001','22222222-2222-4222-8222-222222222222','dddddddd-dddd-4ddd-8ddd-dddddddddddd','pending'),
('33333333-0000-4000-8000-000000000001','33333333-3333-4333-8333-333333333333','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','pending');
INSERT INTO public.payments(participant_id,is_counted) VALUES('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true),('cccccccc-cccc-4ccc-8ccc-cccccccccccc',true);
