-- REVIEW ONLY: owner approval is required before applying this exact file.
-- No data updates, table recreation, or migration-history repair.
BEGIN;

-- Membership lookup must bypass membership RLS to avoid recursive evaluation.
DO $preflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
    WHERE p.oid = 'public.maintiva_is_shop_member(text)'::regprocedure
      AND p.prosecdef AND r.rolbypassrls
  ) THEN
    RAISE EXCEPTION 'Review membership helper ownership before applying RLS repair';
  END IF;
END
$preflight$;

-- Restore only the audited missing policies. Control-plane writes (including
-- membership creation) and audit-log writes remain backend-only.
DO $policies$
DECLARE
  table_name text;
  predicate text;
  command text;
  policy_name text;
  commands text[];
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'User', 'Shop', 'ShopMembership', 'AuditLog', 'Customer', 'Vehicle',
    'Appointment', 'DeclinedWorkRecord', 'ImportHistoryRecord', 'ImportRowRecord'
  ] LOOP
    predicate := CASE table_name
      WHEN 'User' THEN '"id" = auth.uid()::text'
      WHEN 'Shop' THEN 'public.maintiva_is_shop_member("id")'
      ELSE 'public.maintiva_is_shop_member("shopId")'
    END;
    commands := CASE WHEN table_name = ANY(ARRAY['User', 'Shop', 'ShopMembership', 'AuditLog'])
      THEN ARRAY['SELECT'] ELSE ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] END;

    -- Unexpected policies need a new review, not silently additive permissive rules.
    IF EXISTS (
      SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public'
        AND p.tablename = table_name
        AND p.policyname NOT IN (
          SELECT 'maintiva_repair_' || lower(c) FROM unnest(commands) AS c
        )
    ) THEN
      RAISE EXCEPTION 'Unexpected existing policies on %; review before repair', table_name;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    FOREACH command IN ARRAY commands LOOP
      policy_name := 'maintiva_repair_' || lower(command);
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public'
          AND p.tablename = table_name AND p.policyname = policy_name
      ) THEN
        EXECUTE format('CREATE POLICY %I ON public.%I FOR %s TO authenticated %s',
          policy_name, table_name, command,
          CASE command
            WHEN 'INSERT' THEN 'WITH CHECK (' || predicate || ')'
            WHEN 'UPDATE' THEN 'USING (' || predicate || ') WITH CHECK (' || predicate || ')'
            ELSE 'USING (' || predicate || ')'
          END);
      END IF;
    END LOOP;
  END LOOP;
END
$policies$;

-- Preserve existing member-scoped policies on service/request/block tables.
-- RLS cannot protect TRUNCATE: remove all browser grants before restoring DML.
DO $grants$
DECLARE
  table_name text;
  privileges text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'User', 'Shop', 'ShopMembership', 'AuditLog', 'Customer', 'Vehicle',
    'Appointment', 'DeclinedWorkRecord', 'ImportHistoryRecord', 'ImportRowRecord',
    'ServiceDefinition', 'VehicleMaintenanceRecord', 'ServiceHistoryRecord',
    'VehicleDrivingProfile', 'VehicleMileageReading', 'AppointmentService',
    'MaintenanceRevenueOpportunity', 'OutreachRecord', 'AppointmentRequest',
    'AppointmentRequestLink', 'AppointmentRequestService', 'AppointmentRequestLinkService',
    'SmartMaintenanceBlock', 'SmartMaintenanceBlockService', 'SmartMaintenanceBlockBlackout'
  ] LOOP
    IF NOT (SELECT c.relrowsecurity FROM pg_class c
      WHERE c.oid = format('public.%I', table_name)::regclass) THEN
      RAISE EXCEPTION 'RLS unexpectedly disabled on %', table_name;
    END IF;
    privileges := CASE
      WHEN table_name = ANY(ARRAY['User', 'Shop', 'ShopMembership', 'AuditLog'])
        THEN 'SELECT'
      WHEN table_name = ANY(ARRAY['AppointmentRequest', 'AppointmentRequestLink',
        'AppointmentRequestService', 'AppointmentRequestLinkService',
        'SmartMaintenanceBlock', 'SmartMaintenanceBlockService'])
        THEN 'SELECT, INSERT, UPDATE'
      ELSE 'SELECT, INSERT, UPDATE, DELETE'
    END;
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', table_name);
    EXECUTE format('GRANT %s ON TABLE public.%I TO authenticated', privileges, table_name);
    -- Explicit backend access survives removal of inherited PUBLIC grants.
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role', table_name);
  END LOOP;
END
$grants$;

ALTER TABLE public."_prisma_migrations" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."_prisma_migrations" FROM PUBLIC, anon, authenticated;
-- Its existing owner/backend grants remain unchanged. Browser access is denied.
COMMIT;
