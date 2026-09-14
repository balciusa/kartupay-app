create table if not exists public.project_base_itinerary_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null,
  description text,
  amount_cents integer not null default 0 check (amount_cents >= 0),
  sort_order integer not null default 0,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(trim(title)) > 0)
);

create index if not exists project_base_itinerary_items_project_id_idx
  on public.project_base_itinerary_items (project_id);
create index if not exists project_base_itinerary_items_project_order_idx
  on public.project_base_itinerary_items (project_id, sort_order, created_at);

alter table public.project_base_itinerary_items enable row level security;

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
);

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
);

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
);

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
);
