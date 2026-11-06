BEGIN TRANSACTION READ ONLY;

WITH target AS (
  SELECT h."vehicleId", h."shopId", h."serviceDefinitionId"
  FROM public."ServiceHistoryRecord" h
  JOIN public."Vehicle" v ON v.id = h."vehicleId" AND v."shopId" = h."shopId"
  WHERE lower(trim(h."serviceName")) = 'oil change' AND v."archivedAt" IS NULL
  ORDER BY (h.mileage = 57000 AND h."completedAt"::date = DATE '2026-01-10') DESC NULLS LAST,
    h."completedAt" DESC, h.id
  LIMIT 1
)
SELECT jsonb_build_object(
  'vehicleAlias', 'vehicle-' || left(md5(v.id), 8),
  'shopTimezone', s.timezone,
  'shopDefaultAnnualMileage', s."defaultAnnualMileage",
  'legacyCurrentMileage', v."currentMileage",
  'legacyAnnualMileage', v."estimatedAnnualMileage",
  'history', (SELECT jsonb_agg(jsonb_build_object(
    'completedAt', h."completedAt"::date, 'mileage', h.mileage,
    'linkedToAssignment', h."maintenanceRecordId" IS NOT NULL
  ) ORDER BY h."completedAt" DESC) FROM public."ServiceHistoryRecord" h
    WHERE h."vehicleId" = v.id AND h."shopId" = v."shopId"
      AND h."serviceDefinitionId" = t."serviceDefinitionId"),
  'service', (SELECT jsonb_build_object(
    'active', d."isActive", 'mileageInterval', d."defaultMileageInterval",
    'timeValue', d."defaultTimeIntervalValue", 'timeUnit', d."defaultTimeIntervalUnit",
    'legacyTimeMonths', d."defaultTimeIntervalMonths",
    'laborMinutes', d."estimatedLaborMinutes", 'priceCents', d."defaultPriceCents"
  ) FROM public."ServiceDefinition" d WHERE d.id = t."serviceDefinitionId" AND d."shopId" = v."shopId"),
  'assignments', (SELECT jsonb_agg(jsonb_build_object(
    'lastCompletedDate', m."lastCompletedDate"::date, 'lastCompletedMileage', m."lastCompletedMileage",
    'mileageOverride', m."mileageIntervalOverride", 'timeValueOverride', m."timeIntervalValueOverride",
    'timeUnitOverride', m."timeIntervalUnitOverride", 'active', m."isActive",
    'status', m.status, 'outreachStatus', m."outreachStatus",
    'thresholdType', m."outreachThresholdType", 'thresholdValue', m."outreachThresholdValue",
    'opportunities', (SELECT jsonb_agg(jsonb_build_object(
      'stage', o.stage, 'source', o.source, 'dueDate', o."dueDate"::date,
      'dueMileage', o."dueMileage", 'daysOverdue', o."daysOverdue", 'milesOverdue', o."milesOverdue"
    )) FROM public."MaintenanceRevenueOpportunity" o WHERE o."maintenanceRecordId" = m.id AND o."shopId" = m."shopId")
  )) FROM public."VehicleMaintenanceRecord" m WHERE m."vehicleId" = v.id AND m."shopId" = v."shopId"
    AND m."serviceDefinitionId" = t."serviceDefinitionId" AND m."archivedAt" IS NULL),
  'readings', (SELECT jsonb_agg(jsonb_build_object(
    'readingDate', r."readingDate"::date, 'readingMileage', r."readingMileage", 'source', r.source,
    'verificationStatus', r."verificationStatus", 'anomalyStatus', r."anomalyStatus", 'includedInForecast', r."includedInForecast"
  ) ORDER BY r."readingDate") FROM public."VehicleMileageReading" r WHERE r."vehicleId" = v.id AND r."shopId" = v."shopId"),
  'profile', (SELECT jsonb_build_object(
    'customerReportedAnnualMileage', p."customerReportedAnnualMileage",
    'manualAnnualMileageOverride', p."manualAnnualMileageOverride", 'calculatedAnnualMileage', p."calculatedAnnualMileage",
    'estimateSource', p."estimateSource", 'confidence', p.confidence
  ) FROM public."VehicleDrivingProfile" p WHERE p."vehicleId" = v.id AND p."shopId" = v."shopId")
) AS trace
FROM target t JOIN public."Vehicle" v ON v.id = t."vehicleId" AND v."shopId" = t."shopId"
JOIN public."Shop" s ON s.id = v."shopId";

COMMIT;
