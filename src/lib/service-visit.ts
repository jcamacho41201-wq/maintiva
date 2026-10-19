import { z } from "zod";

export const serviceVisitSchema = z.object({
  customerId: z.string().min(1),
  vehicleId: z.string().min(1),
  date: z.iso.date(),
  mileage: z.number().int().min(0).max(3000000),
  idempotencyKey: z.string().uuid(),
  notes: z.string().max(2000).optional(),
  services: z.array(z.object({
    serviceDefinitionId: z.string().min(1),
    outcome: z.enum(["COMPLETED", "DEFERRED"]),
    priceCents: z.number().int().min(0).max(100000000),
    dueDate: z.iso.date().optional(),
    dueMileage: z.number().int().min(0).max(3000000).optional(),
  })).min(1).max(20),
}).superRefine((value, context) => {
  const ids = value.services.map((item) => item.serviceDefinitionId);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", path: ["services"], message: "Select each service once, as completed or deferred." });
  for (const [index, service] of value.services.entries()) {
    if (service.outcome === "DEFERRED" && service.dueDate && service.dueDate < value.date) context.addIssue({ code: "custom", path: ["services", index, "dueDate"], message: "Due date cannot precede the service visit." });
    if (service.outcome === "DEFERRED" && service.dueMileage !== undefined && service.dueMileage < value.mileage) context.addIssue({ code: "custom", path: ["services", index, "dueMileage"], message: "Due mileage cannot precede the visit mileage." });
  }
});

export type ServiceVisitInput = z.infer<typeof serviceVisitSchema>;
