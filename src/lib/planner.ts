import type {
  Bay,
  Candidate,
  Coordinate,
  Inventory,
  Plan,
  SavedTrip,
  TripInput,
  SearchTrace,
} from "../types";
import { getInventory, getRoute } from "./api";
import { eligible, holidays, parseParis, parisParts, rushFactor } from "./rules";
export const MODEL_VERSION = "opportunity-v1.0";
export function distance(a: Coordinate, b: Coordinate) {
  const r = Math.PI / 180,
    dLat = (b[1] - a[1]) * r,
    dLon = (b[0] - a[0]) * r,
    s =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}
export function searchEstimate(
  capacity: number,
  arrival: Date,
  arrondissement: number,
  trips: SavedTrip[],
  street: string,
  useExperience: boolean,
  coordinates?: Coordinate,
) {
  const hour = parisParts(arrival).hour;
  const dayClass = (date: Date) => {
    const p = parisParts(date);
    const dow = new Date(`${p.date}T12:00:00Z`).getUTCDay();
    return dow === 0 || holidays(p.year).has(p.date) ? "holiday" : dow === 6 ? "saturday" : "weekday";
  };
  // Explicit uncalibrated priors, not vacancy measurements or probabilities.
  const pressure =
    (arrondissement <= 9 ? 1.3 : 1) * (hour >= 17 && hour < 22 ? 1.2 : 1);
  const baseline = Math.max(
    3,
    Math.min(16, (18 / Math.sqrt(Math.max(1, capacity) / 3)) * pressure),
  );
  const observations = useExperience
    ? trips.filter(
        (t) =>
          t.survey?.outcome === "here" &&
          ["ordinary", "delivery"].includes(t.survey.bayType) &&
          t.candidate.street === street &&
          (!coordinates || (t.candidate.coordinates && distance(t.candidate.coordinates, coordinates) <= 200)) &&
          Number.isFinite(Date.parse(t.survey.observedArrival)) &&
          dayClass(new Date(t.survey.observedArrival)) === dayClass(arrival) &&
          Math.abs(
            parisParts(new Date(t.survey.observedArrival)).hour - hour,
          ) <= 2,
      )
    : [];
  const n = observations.length;
  const learned =
    n >= 3
      ? (baseline * 8 +
          observations.reduce((a, t) => a + t.survey!.searchMinutes, 0)) /
        (8 + n)
      : baseline;
  return {
    low: Math.max(1, Math.round(learned * 0.55)),
    high: Math.max(3, Math.round(learned * 1.6)),
    learnedFrom: n >= 3 ? n : 0,
  };
}
type Group = {
  id: string;
  street: string;
  arrondissement: number;
  coordinates: Coordinate;
  bays: Bay[];
  capacity: number;
  distance: number;
};
export function groupsFor(inventory: Inventory, input: TripInput): Group[] {
  const radius = Math.min(2200, input.maxWalk * 80); // Only a coarse prefilter; routed walking decides eligibility.
  const departure = parseParis(input.departure), returnAt = parseParis(input.returnAt);
  const groups: Group[] = [];
  const byStreet = new Map<string, Group[]>();
  // Anchor mixed stretches on ordinary spaces, so a reserved delivery section cannot hide its neighbours.
  const priority = { free: 0, paid: 1, shared: 2 };
  for (const bay of [...inventory.bays].sort((a, b) => priority[a.kind] - priority[b.kind])) {
    const d = distance(bay.coordinates, input.destination.coordinates);
    if (d > radius || bay.customHours || bay.capacity <= 0) continue;
    const list = byStreet.get(bay.street) || [];
    // Tight anchor radius avoids connecting distant pieces of the same named street.
    let group = list.find(
      (g) => distance(g.coordinates, bay.coordinates) <= 85,
    );
    if (!group) {
      group = {
        id: bay.id,
        street: bay.street,
        arrondissement: bay.arrondissement,
        coordinates: bay.coordinates,
        bays: [],
        capacity: 0,
        distance: d,
      };
      list.push(group);
      byStreet.set(bay.street, list);
      groups.push(group);
    }
    group.bays.push(bay);
    // Departure-time availability is a conservative shortlist score only. Actual eligibility is checked at routed arrival below.
    if (eligible(bay, departure, returnAt)) group.capacity += bay.capacity;
  }
  const nearest = [...groups]
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3);
  const promising = [...groups].sort(
    (a, b) =>
      b.capacity / (1 + b.distance / 450) - a.capacity / (1 + a.distance / 450),
  );
  const spread = [...groups].sort(
    (a, b) =>
      distance(a.coordinates, input.origin.coordinates) +
      a.distance * 0.2 -
      (distance(b.coordinates, input.origin.coordinates) + b.distance * 0.2),
  );
  const shortlist: Group[] = [];
  for (const group of [
    ...nearest,
    ...promising.slice(0, 7),
    ...spread.slice(0, 4),
  ])
    if (!shortlist.some((x) => x.id === group.id)) shortlist.push(group);
  return shortlist.slice(0, 12);
}
export async function planTrip(
  input: TripInput,
  trips: SavedTrip[],
  progress: (stage: string, count?: number) => void,
  signal: AbortSignal,
  onTrace?: (trace: SearchTrace) => void,
): Promise<Plan> {
  const departure = parseParis(input.departure),
    returnAt = parseParis(input.returnAt);
  if (returnAt <= departure)
    throw new Error("Your return time must be after departure.");
  if (returnAt.getTime() - departure.getTime() > 24 * 3600000)
    throw new Error("For this pilot, plan a trip lasting less than 24 hours.");
  if (input.maxWalk < 5 || input.maxWalk > 30)
    throw new Error("Choose a walking limit between 5 and 30 minutes.");
  const [lng, lat] = input.destination.coordinates;
  if (lng < 2.25 || lng > 2.415 || lat < 48.813 || lat > 48.905)
    throw new Error(
      "Choose a destination inside Paris. The Bois de Boulogne and Vincennes are outside this pilot.",
    );
  const multiplier = rushFactor(departure, input.rushAllowance);
  let directDrive: number | null = null;
  progress("Tracing your journey through the streets", 3);
  try {
    const direct = await getRoute(input.origin.coordinates, input.destination.coordinates, "car", signal);
    directDrive = direct.duration * multiplier / 60;
    onTrace?.({ id: "direct", geometry: direct.geometry });
  } catch {
    signal.throwIfAborted();
  }
  progress("Reading the Paris parking inventory", 6);
  const inventory = await getInventory();
  signal.throwIfAborted();
  const groups = groupsFor(inventory, input);
  if (!groups.length)
    throw new Error(
      "No supported parking streets were found nearby. Try a longer walking limit.",
    );
  const candidates: Candidate[] = [],
    warnings: string[] = [];
  let failed = 0;
  for (let index = 0; index < groups.length; index++) {
    signal.throwIfAborted();
    const g = groups[index];
    progress(
      `Comparing street ${index + 1} of ${groups.length}`,
      8 + Math.round((index / groups.length) * 82),
    );
    try {
      const walk = await getRoute(
        g.coordinates,
        input.destination.coordinates,
        "pedestrian",
        signal,
      );
      if (walk.duration > input.maxWalk * 60) continue;
      const drive = await getRoute(
        input.origin.coordinates,
        g.coordinates,
        "car",
        signal,
      );
      onTrace?.({ id: g.id, geometry: { type: "LineString", coordinates: [...drive.geometry.coordinates, ...walk.geometry.coordinates] } });
      // Eligibility uses earliest modelled arrival; a congestion allowance must not unlock delivery bays.
      const earliestArrival = new Date(
        departure.getTime() + drive.duration * 1000,
      );
      const arrival = new Date(
        departure.getTime() + drive.duration * multiplier * 1000,
      );
      if (arrival >= returnAt) continue;
      const allowed = g.bays.filter((b) =>
        eligible(b, earliestArrival, returnAt),
      );
      const bays: Bay[] = [];
      let maxWalkDuration = walk.duration;
      // Route every counted section. A centroid or a straight-line radius cannot establish a walking cap.
      for (const bay of allowed) {
        const sectionWalk =
          bay.id === g.id
            ? walk
            : await getRoute(
                bay.coordinates,
                input.destination.coordinates,
                "pedestrian",
                signal,
              );
        if (sectionWalk.duration <= input.maxWalk * 60) {
          bays.push(bay);
          maxWalkDuration = Math.max(maxWalkDuration, sectionWalk.duration);
        }
      }
      if (!bays.some((b) => b.id === g.id)) continue;
      const capacity = bays.reduce((s, b) => s + b.capacity, 0);
      if (capacity === 0) continue;
      const search = searchEstimate(
        capacity,
        arrival,
        g.arrondissement,
        trips,
        g.street,
        input.useExperience,
        g.coordinates,
      );
      const driveMinutes = (drive.duration * multiplier) / 60,
        walkMinutes = maxWalkDuration / 60;
      // Even a zero-minute visit needs a walk to the destination and back to the car.
      if (arrival.getTime() + (search.low + 2 * walkMinutes) * 60000 > returnAt.getTime()) continue;
      candidates.push({
        id: g.id,
        street: g.street,
        arrondissement: g.arrondissement,
        coordinates: g.coordinates,
        bays,
        capacity,
        sharedCapacity: bays
          .filter((b) => b.kind === "shared")
          .reduce((s, b) => s + b.capacity, 0),
        drive,
        walk,
        driveMinutes,
        walkMinutes,
        searchLow: search.low,
        searchHigh: search.high,
        totalLow: driveMinutes + walkMinutes + search.low,
        totalHigh: driveMinutes + walkMinutes + search.high,
        total: driveMinutes + walkMinutes + (search.low + search.high) / 2,
        arrival: arrival.toISOString(),
        learnedFrom: search.learnedFrom,
        reason:
          capacity >= 15
            ? "More mapped spaces along a compact stretch."
            : walkMinutes < 8
              ? "A short walk after you park."
              : "A different balance of driving and walking.",
        parkingType: bays.every((b) => b.kind === "paid")
          ? "paid"
          : bays.every((b) => b.kind !== "paid")
            ? "free"
            : "mixed",
      });
    } catch (error) {
      if (signal.aborted) throw error;
      failed++;
    }
  }
  if (failed)
    warnings.push(`${failed} streets could not be routed and were left out.`);
  if (Date.now() - Date.parse(inventory.updated) > 7 * 86400000)
    warnings.push("The parking inventory is more than a week old; recent street changes may be missing.");
  if (!candidates.length)
    throw new Error(
      failed === groups.length
        ? "The routing service could not respond. Please try again."
        : "No suitable streets fit this walking limit and parking period. Try a longer walk or a shorter stay; paid visitor parking is limited to six hours.",
    );
  const sorted = candidates.sort((a, b) => a.total - b.total),
    distinct: Candidate[] = [];
  for (const c of sorted)
    if (
      !distinct.some(
        (s) =>
          s.street === c.street || distance(s.coordinates, c.coordinates) < 140,
      )
    ) {
      distinct.push(c);
      if (distinct.length === 3) break;
    }
  progress("Putting your best arrivals in order", 95);
  return {
    input,
    candidates: distinct,
    directDrive,
    inventoryDate: inventory.updated,
    compared: candidates.length,
    modelVersion: MODEL_VERSION,
    warnings,
  };
}
