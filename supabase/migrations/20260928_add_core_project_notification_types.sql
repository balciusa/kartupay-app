alter table public.project_notifications
  drop constraint if exists project_notifications_notification_type_check;

alter table public.project_notifications
  add constraint project_notifications_notification_type_check
  check (notification_type in (
    'date_selection_required',
    'date_voting_reminder',
    'date_selected_confirmation_required',
    'date_confirmation_24h',
    'date_confirmation_2h',
    'date_confirmation_manual',
    'join_request_pending',
    'date_availability_24h',
    'date_availability_2h'
  ));
