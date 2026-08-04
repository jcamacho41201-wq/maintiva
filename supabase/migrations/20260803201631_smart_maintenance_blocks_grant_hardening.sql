-- Smart Maintenance Blocks grant hardening.
-- This migration is idempotent and intentionally limited to table privileges.

REVOKE ALL PRIVILEGES ON TABLE
  public."SmartMaintenanceBlock",
  public."SmartMaintenanceBlockService",
  public."SmartMaintenanceBlockBlackout"
FROM PUBLIC;

REVOKE ALL PRIVILEGES ON TABLE
  public."SmartMaintenanceBlock",
  public."SmartMaintenanceBlockService",
  public."SmartMaintenanceBlockBlackout"
FROM anon;

REVOKE ALL PRIVILEGES ON TABLE
  public."SmartMaintenanceBlock",
  public."SmartMaintenanceBlockService",
  public."SmartMaintenanceBlockBlackout"
FROM authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE
  public."SmartMaintenanceBlock",
  public."SmartMaintenanceBlockService"
TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public."SmartMaintenanceBlockBlackout"
TO authenticated;

GRANT ALL PRIVILEGES ON TABLE
  public."SmartMaintenanceBlock",
  public."SmartMaintenanceBlockService",
  public."SmartMaintenanceBlockBlackout"
TO service_role;
