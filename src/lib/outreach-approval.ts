export function outreachApprovalKey(input: {
  shopId: string;
  customerId: string;
  vehicleId: string;
  phone: string;
  consent: string;
  body: string;
  opportunityIds: string[];
}) {
  return JSON.stringify({ ...input, opportunityIds: [...input.opportunityIds].sort() });
}
