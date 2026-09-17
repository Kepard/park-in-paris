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
  totalMinutes: 10,
  totalMetres: 2400,
  addedWalkMinutes: 8,
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
export type CircuitRoutingBudget = {
  remaining: number;
  cache: Map<string, RouteData | null>;
};
export const createCircuitRoutingBudget = (): CircuitRoutingBudget => ({ remaining: 48, cache: new Map() });

type CircuitOptions = {
  maxRequests?: number;
  routingBudget?: CircuitRoutingBudget;
  route?: typeof getRoute;
  onTrace?: (trace: SearchTrace) => void;
  estimate?: (candidate: Candidate, capacity: number, arrival: Date) => Estimate;
};

/** Compare a modest delay with having useful fallback streets; the penalty is never shown as travel time. */
export function rankSearchRoutes(candidates: Candidate[]): Candidate[] {
  const score = (candidate: Candidate) => {
    const stops = candidate.searchRoute?.stops.length ?? 1;
    return candidate.total + (stops >= 4 ? 0 : stops === 3 ? 1 : stops === 2 ? 3 : 6);
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
  const earliest = new Date(departure.getTime() + primary.drive.duration * 1000);
  const latest = new Date(departure.getTime() + primary.driveMinutes * 60000);
  const firstBays = primary.bays.filter(bay => eligible(bay, earliest, returnAt) && eligible(bay, latest, returnAt));
  type State = {
    previous: Candidate; previousSearch: Estimate; earliest: Date; latest: Date; scenarioLow: number;
    stops: SearchStop[]; visited: Set<string>; usedBays: Set<string>; extraDriveMinutes: number; extraDistance: number;
  };
  const initial: State = {
    previous: primary, previousSearch: { low: primary.searchLow, high: primary.searchHigh }, earliest, latest,
    scenarioLow: primary.driveMinutes,
    stops: [stopFor(primary, firstBays, earliest, latest, primary.totalLow, primary.totalHigh)],
    visited: new Set([primary.street]), usedBays: new Set(firstBays.map(bay => bay.id)),
    extraDriveMinutes: 0, extraDistance: 0,
  };
  const budget = options.routingBudget ?? createCircuitRoutingBudget();
  let requests = 0, best = initial;
  const quality = (state: State) => state.stops.slice(1).reduce((sum, stop) => sum + stop.capacity, 0) /
    (1 + state.extraDriveMinutes);

  async function transitionTo(from: Candidate, to: Candidate): Promise<RouteData | null> {
    const key = `${from.coordinates.join(",")}>${to.coordinates.join(",")}`;
    if (budget.cache.has(key)) return budget.cache.get(key)!;
    // All three suggestions share the global cache and budget; a difficult first suggestion cannot consume everything.
    if (requests >= (options.maxRequests ?? 16) || budget.remaining <= 0) return null;
    requests++;
    budget.remaining--;
    try {
      const transition = await route(from.coordinates, to.coordinates, "car", signal);
      signal.throwIfAborted();
      budget.cache.set(key, transition);
      options.onTrace?.({ id: `circuit-check-${from.id}-${to.id}`, geometry: transition.geometry });
      return transition;
    } catch {
      signal.throwIfAborted();
      budget.cache.set(key, null);
      return null;
    }
  }

  // Seek the complete four-street path first. Backtrack when a promising street is a directed-road dead end.
  // Depth, nearby branches and route requests are bounded; no unbounded graph crawl of Paris is performed.
  async function explore(state: State): Promise<boolean> {
    signal.throwIfAborted();
    if (state.stops.length > best.stops.length ||
      (state.stops.length === best.stops.length && quality(state) > quality(best))) best = state;
    if (state.stops.length === CIRCUIT_LIMITS.streets) return true;
    const nearby = candidates.filter(candidate =>
      !state.visited.has(candidate.street) && candidate.capacity >= CIRCUIT_LIMITS.minimumCapacity && candidate.walkMinutes <= input.maxWalk &&
      candidate.walkMinutes <= primary.walkMinutes + CIRCUIT_LIMITS.addedWalkMinutes &&
      metresBetween(state.previous.coordinates, candidate.coordinates) <= CIRCUIT_LIMITS.nearbyMetres &&
      metresBetween(primary.coordinates, candidate.coordinates) <= CIRCUIT_LIMITS.fromStartMetres,
    ).sort((a, b) => {
      const score = (candidate: Candidate) => candidate.capacity /
        (1 + metresBetween(state.previous.coordinates, candidate.coordinates) / 180 + Math.max(0, candidate.walkMinutes - primary.walkMinutes) / 3);
      return score(b) - score(a);
    });
    for (const candidate of nearby.slice(0, 4)) {
      signal.throwIfAborted();
      const transition = await transitionTo(state.previous, candidate);
      if (!transition) continue;
      const minutes = transition.duration * factor / 60;
      if (!Number.isFinite(minutes) || minutes < 0 || !Number.isFinite(transition.distance) || transition.distance < 0 ||
        minutes > CIRCUIT_LIMITS.legMinutes || transition.distance > CIRCUIT_LIMITS.legMetres ||
        state.extraDriveMinutes + minutes > CIRCUIT_LIMITS.totalMinutes || state.extraDistance + transition.distance > CIRCUIT_LIMITS.totalMetres) continue;

      // Never unlock a delivery bay by assuming congestion or time spent on earlier unsuccessful searches.
      const nextEarliest = new Date(state.earliest.getTime() + transition.duration * 1000);
      const nextLatest = new Date(state.latest.getTime() + (state.previousSearch.high + minutes) * 60000);
      const nextLow = state.scenarioLow + state.previousSearch.low + minutes;
      const bays = candidate.bays.filter(bay => !state.usedBays.has(bay.id) &&
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
      const next: State = {
        previous: candidate, previousSearch: search, earliest: nextEarliest, latest: nextLatest, scenarioLow: nextLow,
        stops: [...state.stops, stop], visited: new Set([...state.visited, candidate.street]),
        usedBays: new Set([...state.usedBays, ...bays.map(bay => bay.id)]),
        extraDriveMinutes: state.extraDriveMinutes + minutes, extraDistance: state.extraDistance + transition.distance,
      };
      if (await explore(next)) return true;
    }
    return false;
  }
  await explore(initial);
  const stops = best.stops;
  return {
    stops,
    capacity: stops.reduce((sum, stop) => sum + stop.capacity, 0),
    extraDriveMinutes: best.extraDriveMinutes,
    totalLow: Math.min(...stops.map(stop => stop.totalLow)),
    totalHigh: Math.max(...stops.map(stop => stop.totalHigh)),
  };
}
