-- Isolated Postgres test setup; follows deployed initialization trigger semantics.
ALTER TABLE public.projects ADD COLUMN date_mode text DEFAULT 'fixed';
ALTER TABLE public.participants ADD COLUMN attendance_updated_at timestamptz;
CREATE OR REPLACE FUNCTION public.initialize_project_participant_date_state()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_date_mode text;
BEGIN
 IF new.left_at IS NULL AND (tg_op='INSERT' OR (tg_op='UPDATE' AND old.left_at IS NOT NULL)) THEN
  SELECT p.date_mode INTO v_date_mode FROM public.projects p
  WHERE p.id=new.project_id FOR UPDATE;
  new.attendance_status:=CASE WHEN v_date_mode='selecting'
    THEN 'pending_date_selection' ELSE 'confirmed' END;
  new.attendance_updated_at:=clock_timestamp();
 END IF;
 RETURN new;
END $$;
CREATE TRIGGER participants_initialize_date_state
BEFORE INSERT OR UPDATE OF left_at ON public.participants
FOR EACH ROW EXECUTE FUNCTION public.initialize_project_participant_date_state();

INSERT INTO public.projects(id,status,finance_mode,is_public,max_participants,total_cents,total_is_per_person,date_mode) VALUES
('99999999-9999-4999-8999-999999999999','pending','none',true,3,0,false,'selecting'),
('aaaa9999-9999-4999-8999-999999999999','pending','none',true,2,0,false,'selecting');
INSERT INTO public.participants(id,project_id,user_id,role) VALUES
('99999999-0000-4000-8000-000000000001','99999999-9999-4999-8999-999999999999','99999999-0000-4000-8000-000000000001','organizer'),
('aaaa9999-0000-4000-8000-000000000001','aaaa9999-9999-4999-8999-999999999999','aaaa9999-0000-4000-8000-000000000001','organizer');
