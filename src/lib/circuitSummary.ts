import type { Candidate, CircuitStrategy } from "../types";

export const CIRCUIT_LABELS: Record<CircuitStrategy, string> = {
  balanced: "Golden balance",
  closest: "Closest walk",
  "more-spaces": "More parking options",
};

export function circuitSummary(candidate: Candidate) {
  const route = candidate.searchRoute;
  const stops = route?.stops.length ? route.stops : [candidate];
  const sections = new Map(stops.flatMap(stop => stop.bays.map(bay => [bay.id, bay] as const)));
  const capacity = sections.size ? [...sections.values()].reduce((sum, bay) => sum + bay.capacity, 0)
    : route?.capacity ?? candidate.capacity;
  const driveMetres = stops.reduce((sum, stop) => sum + ("driveFromPrevious" in stop ? stop.driveFromPrevious?.distance ?? 0 : 0), 0);
  const driveMinutes = route?.extraDriveMinutes ?? 0;
  const totalWeight = stops.reduce((sum, stop) => sum + stop.capacity, 0);
  return {
    capacity,
    streetCount: stops.length,
    driveMinutes,
    driveMetres,
    walkMin: Math.min(...stops.map(stop => stop.walkMinutes)),
    walkMax: Math.max(...stops.map(stop => stop.walkMinutes)),
    walkWeighted: totalWeight ? stops.reduce((sum, stop) => sum + stop.walkMinutes * stop.capacity, 0) / totalWeight : candidate.walkMinutes,
    totalLow: route?.totalLow ?? candidate.totalLow,
    totalHigh: route?.totalHigh ?? candidate.totalHigh,
  };
}
