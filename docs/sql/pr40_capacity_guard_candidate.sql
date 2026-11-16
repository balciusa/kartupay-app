-- PR40 REVIEW-ONLY: cross-writer capacity guard. NOT A MIGRATION.
-- Add as BEFORE INSERT OR UPDATE OF left_at, project_id ON participants.
-- Project-scoped row lock is required even for raw service-role inserts.
BEGIN;
CREATE OR REPLACE FUNCTION public.pr40_enforce_active_capacity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE p public.projects%ROWTYPE;
  active_count bigint;
BEGIN
  IF tg_op='UPDATE' AND new.project_id IS DISTINCT FROM old.project_id THEN
    RAISE EXCEPTION 'Participant project reassignment is not supported'
      USING ERRCODE='22023';
  END IF;
  IF new.left_at IS NOT NULL THEN RETURN new; END IF;
  IF tg_op='UPDATE' AND old.left_at IS NULL THEN RETURN new; END IF;

  SELECT * INTO p FROM public.projects WHERE id=new.project_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found' USING ERRCODE='P0002';
  END IF;
  IF lower(trim(coalesce(p.status,''))) IN ('canceled','cancelled')
      OR p.canceled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot join a canceled project' USING ERRCODE='P0001';
  END IF;
  SELECT count(*) INTO active_count FROM public.participants
   WHERE project_id=new.project_id AND left_at IS NULL;
  IF p.max_participants IS NOT NULL AND active_count >= p.max_participants THEN
    RAISE EXCEPTION 'Project capacity has been reached' USING ERRCODE='23514';
  END IF;
  RETURN new;
END
$fn$;
DROP TRIGGER IF EXISTS pr40_participants_capacity_guard ON public.participants;
CREATE TRIGGER pr40_participants_capacity_guard
 BEFORE INSERT OR UPDATE OF left_at, project_id ON public.participants
 FOR EACH ROW EXECUTE FUNCTION public.pr40_enforce_active_capacity();
REVOKE ALL ON FUNCTION public.pr40_enforce_active_capacity() FROM PUBLIC,anon,authenticated;
COMMIT;
