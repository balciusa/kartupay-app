-- PR40 DESIGN CANDIDATE ONLY. NOT A MIGRATION. NEVER APPLY TO PRODUCTION.
-- Inputs are prepared by authenticated server code using paymentRecipient.ts.
-- Independent multi-session Postgres concurrency and fault tests REQUIRED.
BEGIN;

CREATE OR REPLACE FUNCTION public.pr40_price_per_person(
  p_total bigint, p_per_person boolean, p_count integer,
  p_bundle_size integer, p_bundle_pay_for integer
) RETURNS bigint LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $fn$
DECLARE n integer := greatest(1,coalesce(p_count,0));
  cents bigint := greatest(0,coalesce(p_total,0));
  units integer;
BEGIN
  IF NOT coalesce(p_per_person,false) THEN
    RETURN floor(cents::numeric/n)::bigint;
  END IF;
  units := CASE WHEN p_bundle_size>=2 AND p_bundle_pay_for>=1
                      AND p_bundle_pay_for<p_bundle_size
    THEN (n/p_bundle_size)*p_bundle_pay_for+(n%p_bundle_size)
    ELSE n END;
  RETURN floor(cents::numeric*units/n)::bigint;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.pr40_approve_managed_membership_atomic(
  p_project_id uuid, p_request_id uuid, p_actor_user_id uuid,
  p_validated_options jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  pr public.projects%ROWTYPE;
  req public.join_requests%ROWTYPE;
  actor public.participants%ROWTYPE;
  member public.participants%ROWTYPE;
  is_new boolean := false;
  seats bigint;
  before_count integer;
  candidates uuid[] := ARRAY[]::uuid[];
  recipients uuid[] := ARRAY[]::uuid[];
  recipient uuid;
  collector_id uuid;
  previous_share bigint;
  next_share bigint;
  share_difference bigint := 0;
  bundle_size integer;
  bundle_pay_for integer;
  is_finalized boolean;
  is_collecting boolean;
  options_written integer := 0;
  transfers_written integer := 0;
  inserted_count integer;
BEGIN
  IF p_project_id IS NULL OR p_request_id IS NULL OR p_actor_user_id IS NULL
    OR jsonb_typeof(p_validated_options) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid managed approval inputs' USING ERRCODE='22023';
  END IF;

  -- Project must ALWAYS be the first lock; date finalization uses the same lock.
  SELECT * INTO pr FROM public.projects WHERE id=p_project_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Project not found' USING ERRCODE='P0002'; END IF;
  IF lower(trim(coalesce(pr.status,''))) IN ('canceled','cancelled')
      OR pr.canceled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Canceled project' USING ERRCODE='P0001';
  END IF;
  IF pr.finance_mode IS DISTINCT FROM 'managed' THEN
    RAISE EXCEPTION 'Managed finance required' USING ERRCODE='22023';
  END IF;

  -- Lock order: projects -> join_requests -> participants.
  SELECT * INTO req FROM public.join_requests
    WHERE id=p_request_id AND project_id=p_project_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Join request not found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO actor FROM public.participants
    WHERE project_id=p_project_id AND user_id=p_actor_user_id AND left_at IS NULL;
  IF NOT FOUND OR NOT (actor.role='organizer'
     OR (pr.is_public IS TRUE AND actor.id=pr.collector_participant_id)) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501';
  END IF;
  IF req.status IS DISTINCT FROM 'pending' THEN
    RETURN jsonb_build_object('outcome','request_not_pending','request_id',req.id);
  END IF;

  -- This RPC is service-role only; staged options must ALSO pass server-side
  -- paymentRecipient.ts validation/normalization. Reject malformed rows.
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_validated_options)
      AS o(type text,label text,value text,priority integer)
    WHERE o.type IS NULL OR o.type NOT IN ('iban','revolut','swedbank')
      OR o.label IS NULL OR o.value IS NULL OR btrim(o.value)=''
      OR (o.type='iban' AND btrim(o.label)='')
      OR o.priority IS NULL OR o.priority<0
  ) THEN RAISE EXCEPTION 'Invalid payment option payload' USING ERRCODE='22023'; END IF;

  SELECT * INTO member FROM public.participants
    WHERE project_id=p_project_id AND user_id=req.requester_user_id;
  IF NOT FOUND OR member.left_at IS NOT NULL THEN
    SELECT count(*) INTO seats FROM public.participants
      WHERE project_id=p_project_id AND left_at IS NULL;
    IF pr.max_participants IS NOT NULL AND seats>=pr.max_participants THEN
      RETURN jsonb_build_object('outcome','full','request_id',req.id);
    END IF;
    is_new := true;
    IF member.id IS NOT NULL THEN
      UPDATE public.participants SET left_at=NULL WHERE id=member.id RETURNING * INTO member;
    ELSE
      INSERT INTO public.participants(project_id,user_id,role)
        VALUES(p_project_id,req.requester_user_id,'member') RETURNING * INTO member;
    END IF;
  END IF;

  -- Transactional, canonical input. DB uniqueness/backdoor writers still need
  -- separate review; this project lock only serializes cooperating writers.
  INSERT INTO public.payment_options(participant_id,type,label,value,priority,is_active)
  SELECT member.id,o.type,o.label,o.value,o.priority,true
  FROM (
    SELECT DISTINCT ON (type,value) type,label,value,priority
    FROM jsonb_to_recordset(p_validated_options)
      AS s(type text,label text,value text,priority integer)
    ORDER BY type,value,priority
  ) o
  WHERE NOT EXISTS (
    SELECT 1 FROM public.payment_options existing
    WHERE existing.participant_id=member.id
      AND existing.type=o.type AND existing.value=o.value
  );
  GET DIAGNOSTICS options_written=ROW_COUNT;

  -- Existing JS computes transfers only for collecting/finalized projects.
  is_finalized := pr.finalized_at IS NOT NULL OR lower(coalesce(pr.status,'')) IN ('closed','finalized');
  is_collecting := lower(coalesce(pr.status,''))='collecting';
  IF is_new AND (is_finalized OR is_collecting) THEN
    SELECT count(*),coalesce(array_agg(p.id ORDER BY p.id),ARRAY[]::uuid[])
      INTO before_count,candidates FROM public.participants p
    WHERE p.project_id=p_project_id AND p.id<>member.id
      AND p.left_at IS NULL AND p.attendance_status='confirmed'
      AND (
        (is_finalized AND (pr.finalized_at IS NULL OR p.joined_at IS NULL OR p.joined_at<=pr.finalized_at))
        OR (NOT is_finalized AND (member.joined_at IS NULL OR p.joined_at IS NULL OR p.joined_at<=member.joined_at))
      );
    recipients := candidates;
    IF NOT is_finalized THEN
      SELECT coalesce(array_agg(p.id ORDER BY p.id),ARRAY[]::uuid[])
        INTO recipients FROM public.participants p
      WHERE p.id=ANY(candidates)
        AND EXISTS (SELECT 1 FROM public.payments pay
                    WHERE pay.participant_id=p.id AND pay.is_counted IS TRUE);
    END IF;
    IF before_count>0 AND coalesce(array_length(recipients,1),0)>0 THEN
      -- Production catalog has no bundle columns; preserve legacy null fallback.
      bundle_size := nullif(to_jsonb(pr)->>'bundle_size','')::integer;
      bundle_pay_for := nullif(to_jsonb(pr)->>'bundle_pay_for','')::integer;
      previous_share := public.pr40_price_per_person(coalesce(pr.total_cents,0),pr.total_is_per_person,before_count,bundle_size,bundle_pay_for);
      next_share := public.pr40_price_per_person(coalesce(pr.total_cents,0),pr.total_is_per_person,before_count+1,bundle_size,bundle_pay_for);
      share_difference := abs(previous_share-next_share);
      IF share_difference>0 THEN
        IF previous_share>=next_share THEN
          FOREACH recipient IN ARRAY recipients LOOP
            INSERT INTO public.late_join_transfers(project_id,from_participant_id,to_participant_id,expected_cents)
              VALUES(p_project_id,member.id,recipient,share_difference)
              ON CONFLICT (project_id,from_participant_id,to_participant_id) DO NOTHING;
            GET DIAGNOSTICS inserted_count=ROW_COUNT;
            transfers_written:=transfers_written+inserted_count;
          END LOOP;
        ELSE
          SELECT p.id INTO collector_id FROM public.participants p
            WHERE p.id=pr.collector_participant_id AND p.project_id=p_project_id AND p.left_at IS NULL;
          IF collector_id IS NULL THEN
            SELECT p.id INTO collector_id FROM public.participants p
              WHERE p.project_id=p_project_id AND p.role='organizer' AND p.left_at IS NULL
              ORDER BY p.id LIMIT 1;
          END IF;
          IF collector_id IS NOT NULL THEN
            FOREACH recipient IN ARRAY recipients LOOP
              IF recipient<>collector_id THEN
                INSERT INTO public.late_join_transfers(project_id,from_participant_id,to_participant_id,expected_cents)
                  VALUES(p_project_id,recipient,collector_id,share_difference)
                  ON CONFLICT (project_id,from_participant_id,to_participant_id) DO NOTHING;
                GET DIAGNOSTICS inserted_count=ROW_COUNT;
                transfers_written:=transfers_written+inserted_count;
              END IF;
            END LOOP;
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  UPDATE public.join_requests SET status='approved',approved_by=p_actor_user_id,
    approved_at=clock_timestamp(),participant_id=member.id
  WHERE id=req.id AND status='pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Request state changed' USING ERRCODE='40001'; END IF;

  INSERT INTO public.activity_logs(project_id,entry_type,actor_user_id,actor_participant_id,
    target_user_id,target_participant_id,join_request_id,metadata)
  VALUES (p_project_id,'join_request_approved',p_actor_user_id,actor.id,
    req.requester_user_id,member.id,req.id,'{}'::jsonb);
  IF is_new THEN
    INSERT INTO public.activity_logs(project_id,entry_type,actor_user_id,actor_participant_id,
      target_user_id,target_participant_id,join_request_id,metadata)
    VALUES (p_project_id,'participant_joined',p_actor_user_id,actor.id,
      req.requester_user_id,member.id,req.id,'{"via_join_request":true}'::jsonb);
  END IF;
  RETURN jsonb_build_object('outcome',CASE WHEN is_new THEN 'reserved' ELSE 'already_active' END,
    'request_id',req.id,'participant_id',member.id,
    'options_written',options_written,'transfers_written',transfers_written);
END;
$fn$;
REVOKE ALL ON FUNCTION public.pr40_price_per_person(bigint,boolean,integer,integer,integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pr40_price_per_person(bigint,boolean,integer,integer,integer)
  TO service_role;
REVOKE ALL ON FUNCTION public.pr40_approve_managed_membership_atomic(uuid,uuid,uuid,jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pr40_approve_managed_membership_atomic(uuid,uuid,uuid,jsonb)
  TO service_role;
COMMIT;
