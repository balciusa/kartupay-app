-- Add event start/end timestamps to projects
alter table if exists public.projects
  add column if not exists event_start_at timestamptz null,
  add column if not exists event_end_at timestamptz null;