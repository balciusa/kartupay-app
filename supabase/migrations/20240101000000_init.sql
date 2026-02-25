create extension if not exists "uuid-ossp";

create table if not exists users (
  id uuid primary key default uuid_generate_v4(),
  email text
);

create table if not exists projects (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  description text,
  total_cents bigint not null default 0,
  min_participants int,
  max_participants int,
  deadline_at timestamptz,
  status text not null default 'collecting',
  canceled_at timestamptz,
  closed_at timestamptz,
  aborted_at timestamptz,
  finalized_at timestamptz,
  collector_participant_id uuid,
  currency text default 'EUR',
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table if not exists participants (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'member',
  short_code text,
  joined_at timestamptz not null default now(),
  left_at timestamptz
);

alter table projects
  add constraint fk_collector_participant
  foreign key (collector_participant_id)
  references participants(id);

create table if not exists payments (
  id uuid primary key default uuid_generate_v4(),
  participant_id uuid not null references participants(id) on delete cascade,
  is_counted boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists payment_options (
  id uuid primary key default uuid_generate_v4(),
  participant_id uuid not null references participants(id) on delete cascade,
  type text not null,
  label text,
  value text not null,
  priority int not null default 1,
  is_active boolean not null default true
);

create table if not exists user_payment_options (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null,
  type text not null,
  label text,
  value text not null,
  priority int not null default 1,
  is_active boolean not null default true
);

create table if not exists messages (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references projects(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists addons (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  description text,
  extra_cents bigint not null default 0,
  required_votes int not null default 1
);

create table if not exists addon_votes (
  id uuid primary key default uuid_generate_v4(),
  addon_id uuid not null references addons(id) on delete cascade
);

create table if not exists join_requests (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references projects(id) on delete cascade,
  requester_user_id uuid not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  unique (project_id, requester_user_id)
);

create table if not exists late_join_transfers (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references projects(id) on delete cascade,
  from_participant_id uuid not null references participants(id) on delete cascade,
  to_participant_id uuid not null references participants(id) on delete cascade,
  expected_cents bigint not null default 0,
  received_at timestamptz,
  sender_marked_at timestamptz,
  unique (project_id, from_participant_id, to_participant_id)
);

create table if not exists payment_signals (
  id uuid primary key default uuid_generate_v4(),
  participant_id uuid not null references participants(id) on delete cascade,
  cleared_at timestamptz,
  created_at timestamptz not null default now()
);
