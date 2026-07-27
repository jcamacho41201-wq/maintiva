export type VinDecodeResult = {
  year?: number;
  make?: string;
  model?: string;
  engine?: string;
  trim?: string;
  vehicleType?: string;
};

export interface VinProvider {
  decode(vin: string): Promise<VinDecodeResult>;
}

export interface CommunicationProvider {
  send(input: {
    to: string;
    channel: "SMS" | "EMAIL" | "CALL";
    message: string;
  }): Promise<{ provider: string; deliveryStatus: "SIMULATED" | "QUEUED" | "SENT" }>;
}

export interface RecallProvider {
  findOpenRecalls(vin: string): Promise<Array<{ title: string; sourceId: string }>>;
}

export interface VehicleHistoryProvider {
  getMileageHistory(vin: string): Promise<Array<{ mileage: number; recordedAt: string; source: string }>>;
}

export class MockVinProvider implements VinProvider {
  async decode(vin: string) {
    if (vin.startsWith("1J4")) {
      return {
        year: 2003,
        make: "Jeep",
        model: "Wrangler",
        engine: "4.0L I6",
        trim: "Sport",
        vehicleType: "SUV",
      };
    }

    return {
      make: "Unknown",
      model: "Pending VIN decode",
      vehicleType: "Passenger vehicle",
    };
  }
}

export class SimulatedCommunicationProvider implements CommunicationProvider {
  async send(input: { to: string; channel: "SMS" | "EMAIL" | "CALL"; message: string }) {
    return {
      provider: `simulated-${input.channel.toLowerCase()}`,
      deliveryStatus: "SIMULATED" as const,
    };
  }
}
