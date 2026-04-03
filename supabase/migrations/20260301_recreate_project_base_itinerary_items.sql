-- Fallback migration for base itinerary items.
-- Safe to run even if parts of the schema already exist.

create table if not exists public.project_base_itinerary_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null,
  description text,
  amount_cents integer not null default 0,
  sort_order integer not null default 0,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.project_base_itinerary_items
  add column if not exists description text,
  add column if not exists amount_cents integer,
  add column if not exists sort_order integer,
  add column if not exists created_by uuid references public.users (id) on delete set null,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

alter table public.project_base_itinerary_items
  alter column amount_cents set default 0,
  alter column sort_order set default 0,
  alter column created_at set default now(),
  alter column updated_at set default now();

update public.project_base_itinerary_items
set
  amount_cents = coalesce(amount_cents, 0),
  sort_order = coalesce(sort_order, 0),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now());

alter table public.project_base_itinerary_items
  alter column amount_cents set not null,
  alter column sort_order set not null,
  alter column created_at set not null,
  alter column updated_at set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'project_base_itinerary_items_title_not_blank'
  ) then
    alter table public.project_base_itinerary_items
      add constraint project_base_itinerary_items_title_not_blank
      check (char_length(trim(title)) > 0);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'project_base_itinerary_items_amount_cents_non_negative'
  ) then
    alter table public.project_base_itinerary_items
      add constraint project_base_itinerary_items_amount_cents_non_negative
      check (amount_cents >= 0);
  end if;
end
$$;

create index if not exists project_base_itinerary_items_project_id_idx
  on public.project_base_itinerary_items (project_id);
create index if not exists project_base_itinerary_items_project_order_idx
  on public.project_base_itinerary_items (project_id, sort_order, created_at);

alter table public.project_base_itinerary_items enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'project_base_itinerary_items'
      and policyname = 'project_base_itinerary_items_select_participants'
  ) then
    execute $policy$
      create policy "project_base_itinerary_items_select_participants"
      on public.project_base_itinerary_items
      for select
      using (
        exists (
          select 1
          from public.participants p
          where p.project_id = project_base_itinerary_items.project_id
            and p.user_id = auth.uid()
            and p.left_at is null
        )
      )
    $policy$;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'project_base_itinerary_items'
      and policyname = 'project_base_itinerary_items_insert_manager'
  ) then
    execute $policy$
      create policy "project_base_itinerary_items_insert_manager"
      on public.project_base_itinerary_items
      for insert
      with check (
        created_by = auth.uid()
        and exists (
          select 1
          from public.participants p
          where p.project_id = project_base_itinerary_items.project_id
            and p.user_id = auth.uid()
            and p.left_at is null
            and (
              p.role = 'organizer'
              or exists (
                select 1
                from public.projects pr
                where pr.id = project_base_itinerary_items.project_id
                  and pr.collector_participant_id = p.id
              )
            )
        )
      )
    $policy$;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'project_base_itinerary_items'
      and policyname = 'project_base_itinerary_items_update_manager'
  ) then
    execute $policy$
      create policy "project_base_itinerary_items_update_manager"
      on public.project_base_itinerary_items
      for update
      using (
        exists (
          select 1
          from public.participants p
          where p.project_id = project_base_itinerary_items.project_id
            and p.user_id = auth.uid()
            and p.left_at is null
            and (
              p.role = 'organizer'
              or exists (
                select 1
                from public.projects pr
                where pr.id = project_base_itinerary_items.project_id
                  and pr.collector_participant_id = p.id
              )
            )
        )
      )
      with check (
        exists (
          select 1
          from public.participants p
          where p.project_id = project_base_itinerary_items.project_id
            and p.user_id = auth.uid()
            and p.left_at is null
            and (
              p.role = 'organizer'
              or exists (
                select 1
                from public.projects pr
                where pr.id = project_base_itinerary_items.project_id
                  and pr.collector_participant_id = p.id
              )
            )
        )
      )
    $policy$;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'project_base_itinerary_items'
      and policyname = 'project_base_itinerary_items_delete_manager'
  ) then
    execute $policy$
      create policy "project_base_itinerary_items_delete_manager"
      on public.project_base_itinerary_items
      for delete
      using (
        exists (
          select 1
          from public.participants p
          where p.project_id = project_base_itinerary_items.project_id
            and p.user_id = auth.uid()
            and p.left_at is null
            and (
              p.role = 'organizer'
              or exists (
                select 1
                from public.projects pr
                where pr.id = project_base_itinerary_items.project_id
                  and pr.collector_participant_id = p.id
              )
            )
        )
      )
    $policy$;
  end if;
end
$$;
