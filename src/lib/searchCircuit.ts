import type { Bay, Candidate, Coordinate, RouteData, SearchRoute, SearchStop, SearchTrace, TripInput } from "../types";
import { getRoute } from "./api";
import { eligible, parseParis, rushFactor } from "./rules";

// Small, local alternatives: distance prefilters never replace directed road routing.
export const CIRCUIT_LIMITS = {
  streets: 4,
  nearbyMetres: 650,
  fromStartMetres: 1000,
  legMinutes: 4,
  legMetres: 1200,
  totalMinutes: 8,
  totalMetres: 2400,
  addedWalkMinutes: 5,
  minimumCapacity: 6,
  minimumSpacesPerDriveMinute: 3,
};

function metresBetween(a: Coordinate, b: Coordinate) {
  const rad = Math.PI / 180;
  const x = Math.sin((b[1] - a[1]) * rad / 2) ** 2 +
    Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin((b[0] - a[0]) * rad / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

type Estimate = { low: number; high: number };
type CircuitOptions = {
  route?: typeof getRoute;
  onTrace?: (trace: SearchTrace) => void;
  estimate?: (candidate: Candidate, capacity: number, arrival: Date) => Estimate;
};

/** Compare a modest delay with having useful fallback streets; the penalty is never shown as travel time. */
export function rankSearchRoutes(candidates: Candidate[]): Candidate[] {
  const score = (candidate: Candidate) => {
    const stops = candidate.searchRoute?.stops.length ?? 1;
    return candidate.total + (stops >= 3 ? 0 : stops === 2 ? 2 : 5);
  };
  return [...candidates].sort((a, b) => score(a) - score(b) || a.total - b.total);
}

function stopFor(candidate: Candidate, bays: Bay[], arrivalLow: Date, arrivalHigh: Date,
  totalLow: number, totalHigh: number, driveFromPrevious?: RouteData): SearchStop {
  return {
    id: candidate.id, street: candidate.street, arrondissement: candidate.arrondissement,
    coordinates: candidate.coordinates, bays,
    capacity: bays.reduce((sum, bay) => sum + bay.capacity, 0),
    sharedCapacity: bays.filter(bay => bay.kind === "shared").reduce((sum, bay) => sum + bay.capacity, 0),
    walk: candidate.walk, walkMinutes: candidate.walkMinutes,
    parkingType: bays.every(bay => bay.kind === "paid") ? "paid" : bays.every(bay => bay.kind !== "paid") ? "free" : "mixed",
    ...(driveFromPrevious ? { driveFromPrevious } : {}),
    arrivalLow: arrivalLow.toISOString(), arrivalHigh: arrivalHigh.toISOString(), totalLow, totalHigh,
  };
}

/** Candidates already have a walking route to the destination for every counted bay. */
export async function buildSearchRoute(primary: Candidate, candidates: Candidate[], input: TripInput,
  signal: AbortSignal, options: CircuitOptions = {}): Promise<SearchRoute> {
  signal.throwIfAborted();
  const route = options.route ?? getRoute;
  const departure = parseParis(input.departure), returnAt = parseParis(input.returnAt);
  const factor = rushFactor(departure, input.rushAllowance);
  let earliest = new Date(departure.getTime() + primary.drive.duration * 1000);
  let latest = new Date(departure.getTime() + primary.driveMinutes * 60000);
  let scenarioLow = primary.driveMinutes;
  let previous = primary;
  let previousSearch: Estimate = { low: primary.searchLow, high: primary.searchHigh };
  const firstBays = primary.bays.filter(bay => eligible(bay, earliest, returnAt) && eligible(bay, latest, returnAt));
  const stops = [stopFor(primary, firstBays, earliest, latest, primary.totalLow, primary.totalHigh)];
  const visited = new Set([primary.street]);
  const usedBays = new Set(firstBays.map(bay => bay.id));
  let extraDriveMinutes = 0, extraDistance = 0;

  for (let stage = 1; stage < CIRCUIT_LIMITS.streets; stage++) {
    signal.throwIfAborted();
    const nearby = candidates.filter(candidate =>
      !visited.has(candidate.street) && candidate.capacity >= CIRCUIT_LIMITS.minimumCapacity && candidate.walkMinutes <= input.maxWalk &&
      candidate.walkMinutes <= primary.walkMinutes + CIRCUIT_LIMITS.addedWalkMinutes &&
      metresBetween(previous.coordinates, candidate.coordinates) <= CIRCUIT_LIMITS.nearbyMetres &&
      metresBetween(primary.coordinates, candidate.coordinates) <= CIRCUIT_LIMITS.fromStartMetres,
    ).sort((a, b) => {
      const score = (candidate: Candidate) => candidate.capacity /
        (1 + metresBetween(previous.coordinates, candidate.coordinates) / 180 + Math.max(0, candidate.walkMinutes - primary.walkMinutes) / 3);
      return score(b) - score(a);
    });
    type Choice = { candidate: Candidate; stop: SearchStop; search: Estimate; earliest: Date; latest: Date; scenarioLow: number; minutes: number; distance: number; score: number };
    let best: Choice | undefined;
    let feasible = 0;
    // Compare two viable directed routes per stage, trying at most four if roads are unreachable.
    for (const candidate of nearby.slice(0, 4)) {
      signal.throwIfAborted();
      let transition: RouteData;
      try {
        transition = await route(previous.coordinates, candidate.coordinates, "car", signal);
        signal.throwIfAborted();
      } catch {
        signal.throwIfAborted();
        continue;
      }
      const minutes = transition.duration * factor / 60;
      if (!Number.isFinite(minutes) || minutes < 0 || !Number.isFinite(transition.distance) || transition.distance < 0 ||
        minutes > CIRCUIT_LIMITS.legMinutes || transition.distance > CIRCUIT_LIMITS.legMetres ||
        extraDriveMinutes + minutes > CIRCUIT_LIMITS.totalMinutes || extraDistance + transition.distance > CIRCUIT_LIMITS.totalMetres) continue;

      // Never unlock a delivery bay by assuming congestion or time spent on earlier unsuccessful searches.
      const nextEarliest = new Date(earliest.getTime() + transition.duration * 1000);
      const nextLatest = new Date(latest.getTime() + (previousSearch.high + minutes) * 60000);
      const nextLow = scenarioLow + previousSearch.low + minutes;
      const bays = candidate.bays.filter(bay => !usedBays.has(bay.id) &&
        eligible(bay, nextEarliest, returnAt) && eligible(bay, nextLatest, returnAt));
      if (!bays.some(bay => bay.id === candidate.id)) continue;
      const capacity = bays.reduce((sum, bay) => sum + bay.capacity, 0);
      if (capacity < CIRCUIT_LIMITS.minimumCapacity || capacity / Math.max(1, minutes) < CIRCUIT_LIMITS.minimumSpacesPerDriveMinute) continue;
      const search = options.estimate?.(candidate, capacity, nextLatest) ?? { low: candidate.searchLow, high: candidate.searchHigh };
      // The full late-search scenario must still allow walking there and back before returning to the car.
      if (nextLatest.getTime() + (search.high + 2 * candidate.walkMinutes) * 60000 > returnAt.getTime()) continue;
      const low = nextLow + search.low + candidate.walkMinutes;
      const high = (nextLatest.getTime() - departure.getTime()) / 60000 + search.high + candidate.walkMinutes;
      const stop = stopFor(candidate, bays, nextEarliest, nextLatest, low, high, transition);
      const score = capacity / (1 + minutes + Math.max(0, candidate.walkMinutes - primary.walkMinutes) / 3);
      if (!best || score > best.score) best = { candidate, stop, search, earliest: nextEarliest, latest: nextLatest, scenarioLow: nextLow, minutes, distance: transition.distance, score };
      if (++feasible === 2) break;
    }
    if (!best) break;
    stops.push(best.stop);
    visited.add(best.candidate.street);
    for (const bay of best.stop.bays) usedBays.add(bay.id);
    previous = best.candidate;
    previousSearch = best.search;
    earliest = best.earliest;
    latest = best.latest;
    scenarioLow = best.scenarioLow;
    extraDriveMinutes += best.minutes;
    extraDistance += best.distance;
    options.onTrace?.({ id: `circuit-${primary.id}-${stage}`, geometry: best.stop.driveFromPrevious!.geometry });
  }
  return {
    stops,
    capacity: stops.reduce((sum, stop) => sum + stop.capacity, 0),
    extraDriveMinutes,
    totalLow: Math.min(...stops.map(stop => stop.totalLow)),
    totalHigh: Math.max(...stops.map(stop => stop.totalHigh)),
  };
}
