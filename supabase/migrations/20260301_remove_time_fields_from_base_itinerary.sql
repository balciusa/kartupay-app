alter table if exists public.project_base_itinerary_items
  drop constraint if exists project_base_itinerary_items_ends_after_starts;

drop index if exists public.project_base_itinerary_items_project_starts_idx;

alter table if exists public.project_base_itinerary_items
  drop column if exists starts_at,
  drop column if exists ends_at;
