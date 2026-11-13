-- PR40 review-only candidate. DO NOT APPLY TO PRODUCTION.
-- Not in supabase/migrations: requires finance/side-effect gate first.
BEGIN;
CREATE OR REPLACE FUNCTION public.reserve_project_membership_atomic(
  p_project_id uuid, p_actor_user_id uuid, p_user_id uuid,
  p_join_request_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_project public.projects%ROWTYPE;
  v_actor public.participants%ROWTYPE;
  v_req public.join_requests%ROWTYPE;
  v_member public.participants%ROWTYPE;
  v_seats bigint;
  v_approval boolean := p_join_request_id IS NOT NULL;
  v_outcome text := 'reserved';
BEGIN
  IF p_project_id IS NULL OR p_actor_user_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'Reservation identity missing' USING ERRCODE = '22023';
  END IF;
  -- First lock: serialization boundary shared with date-finalization trigger.
  SELECT * INTO v_project FROM public.projects
    WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found' USING ERRCODE = 'P0002';
  END IF;
  IF lower(trim(coalesce(v_project.status, ''))) IN ('canceled', 'cancelled')
     OR v_project.canceled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Canceled project' USING ERRCODE = 'P0001';
  END IF;

  IF v_approval THEN
    -- Managed finance would otherwise leave partial payment state: fail closed.
    IF v_project.finance_mode IS DISTINCT FROM 'none' THEN
      RAISE EXCEPTION 'Managed-finance approval not yet supported'
        USING ERRCODE = '0A000';
    END IF;
    -- Project -> request -> participant lock ordering.
    SELECT * INTO v_req FROM public.join_requests
      WHERE id = p_join_request_id AND project_id = p_project_id
      FOR UPDATE;
    IF NOT FOUND OR v_req.requester_user_id IS DISTINCT FROM p_user_id THEN
      RAISE EXCEPTION 'Join request not found for user' USING ERRCODE = 'P0002';
    END IF;
    SELECT * INTO v_actor FROM public.participants
      WHERE project_id = p_project_id AND user_id = p_actor_user_id
        AND left_at IS NULL;
    IF NOT FOUND OR NOT (
      v_actor.role = 'organizer' OR
      (v_project.is_public IS TRUE AND v_actor.id = v_project.collector_participant_id)
    ) THEN
      RAISE EXCEPTION 'Approval is not authorized' USING ERRCODE = '42501';
    END IF;
    IF v_req.status <> 'pending' THEN
      RETURN jsonb_build_object('outcome', 'request_not_pending',
                                'request_id', v_req.id);
    END IF;
  ELSE
    IF p_actor_user_id IS DISTINCT FROM p_user_id THEN
      RAISE EXCEPTION 'Direct join must be self-only' USING ERRCODE = '42501';
    END IF;
    IF v_project.is_public IS DISTINCT FROM TRUE
       OR v_project.finance_mode IS DISTINCT FROM 'none' THEN
      RAISE EXCEPTION 'Approval is required' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT * INTO v_member FROM public.participants
    WHERE project_id = p_project_id AND user_id = p_user_id;
  IF FOUND AND v_member.left_at IS NULL THEN
    v_outcome := 'already_active';
  ELSE
    SELECT count(*) INTO v_seats FROM public.participants
      WHERE project_id = p_project_id AND left_at IS NULL;
    IF v_project.max_participants IS NOT NULL
       AND v_seats >= v_project.max_participants THEN
      RETURN jsonb_build_object('outcome', 'full');
    END IF;
    IF v_member.id IS NOT NULL THEN
      UPDATE public.participants SET left_at = NULL WHERE id = v_member.id
        RETURNING * INTO v_member;
    ELSE
      INSERT INTO public.participants(project_id, user_id, role)
        VALUES (p_project_id, p_user_id, 'member')
        RETURNING * INTO v_member;
    END IF;
  END IF;

  IF v_approval THEN
    UPDATE public.join_requests
      SET status = 'approved', approved_by = p_actor_user_id,
          approved_at = clock_timestamp(), participant_id = v_member.id
      WHERE id = v_req.id AND status = 'pending';
  ELSE
    -- Only pending requests: never revive/rewrite rejected history.
    UPDATE public.join_requests SET status = 'approved'
      WHERE project_id = p_project_id AND requester_user_id = p_user_id
        AND status = 'pending';
  END IF;
  RETURN jsonb_build_object('outcome', v_outcome, 'participant_id', v_member.id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.reserve_project_membership_atomic(uuid,uuid,uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_project_membership_atomic(uuid,uuid,uuid,uuid)
  TO service_role;
COMMIT;
