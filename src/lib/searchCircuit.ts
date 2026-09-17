import type { Bay, Candidate, CircuitStrategy, Coordinate, RouteData, SearchRoute, SearchStop, SearchTrace, TripInput } from "../types";
import { getRoute } from "./api";
import { eligible, parseParis, rushFactor } from "./rules";
import { circuitUtility } from "./circuitRanking";

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
  minimumCloserSpacesPerDriveMinute: 2,
  closerWalkImprovementMinutes: 1,
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

/** Backward-compatible ranking for callers that already hold complete circuits. */
export function rankSearchRoutes(candidates: Candidate[]): Candidate[] {
  return [...candidates].sort((a, b) => circuitUtility(b) - circuitUtility(a));
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
export async function buildSearchRouteOptions(primary: Candidate, candidates: Candidate[], input: TripInput,
  signal: AbortSignal, options: CircuitOptions = {}): Promise<SearchRoute[]> {
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
  let requests = 0;
  let requestCeiling = options.maxRequests ?? 16;
  const asRoute = (state: State): SearchRoute => ({
    stops: state.stops,
    capacity: state.stops.reduce((sum, stop) => sum + stop.capacity, 0),
    extraDriveMinutes: state.extraDriveMinutes,
    totalLow: Math.min(...state.stops.map(stop => stop.totalLow)),
    totalHigh: Math.max(...state.stops.map(stop => stop.totalHigh)),
  });
  const quality = (state: State, strategy: CircuitStrategy = "balanced") =>
    circuitUtility({ ...primary, searchRoute: asRoute(state) }, strategy);
  const strategies: CircuitStrategy[] = ["balanced", "closest", "more-spaces"];
  const explored: State[] = [initial];

  async function transitionTo(from: Candidate, to: Candidate, recoverDeadEnd: boolean): Promise<RouteData | null> {
    const key = `${from.coordinates.join(",")}>${to.coordinates.join(",")}`;
    if (budget.cache.has(key)) return budget.cache.get(key)!;
    // An unsuccessful frontier can borrow from its later-depth allowance to try another actual road exit.
    if (recoverDeadEnd && requests >= requestCeiling && requests < (options.maxRequests ?? 16)) requestCeiling++;
    // Suggestions share the global cache and budget; a difficult first suggestion cannot consume everything.
    if (requests >= requestCeiling || budget.remaining <= 0) return null;
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

  // Expand several competing orders at each depth. Reaching four streets never ends the comparison.
  // The shared directed-edge cache also lets later starts reuse this graph without more API requests.
  let frontier: State[] = [initial];
  for (let depth = 1; depth < CIRCUIT_LIMITS.streets && frontier.length; depth++) {
    requestCeiling = Math.ceil((options.maxRequests ?? 16) * [0, 0.25, 0.65, 1][depth]);
    const nextStates: State[] = [];
    for (const state of frontier) {
      signal.throwIfAborted();
      const nearby = candidates.filter(candidate =>
        !state.visited.has(candidate.street) && candidate.capacity >= CIRCUIT_LIMITS.minimumCapacity && candidate.walkMinutes <= input.maxWalk &&
        candidate.walkMinutes <= primary.walkMinutes + CIRCUIT_LIMITS.addedWalkMinutes &&
        metresBetween(state.previous.coordinates, candidate.coordinates) <= CIRCUIT_LIMITS.nearbyMetres &&
        metresBetween(primary.coordinates, candidate.coordinates) <= CIRCUIT_LIMITS.fromStartMetres,
      );
      const proximity = (candidate: Candidate) => metresBetween(state.previous.coordinates, candidate.coordinates);
      const density = [...nearby].sort((a, b) => b.capacity / (1 + proximity(b) / 180) - a.capacity / (1 + proximity(a) / 180));
      const closest = [...nearby].sort((a, b) => a.walkMinutes - b.walkMinutes || proximity(a) - proximity(b));
      const abundant = [...nearby].sort((a, b) => b.capacity - a.capacity || proximity(a) - proximity(b));
      const prospective = [...new Map([density[0], closest[0], abundant[0], ...density].filter(Boolean).map(candidate => [candidate.id, candidate])).values()].slice(0, 8);
      // All previously checked edges remain available to comparison, even outside the bounded new-edge probes.
      const cached = nearby.filter(candidate => budget.cache.get(`${state.previous.coordinates.join(",")}>${candidate.coordinates.join(",")}`));
      const branches = [...new Map([...prospective, ...cached].map(candidate => [candidate.id, candidate])).values()];
      for (const candidate of branches) {
        signal.throwIfAborted();
        const transition = await transitionTo(state.previous, candidate, nextStates.length === 0);
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
        // A move toward the destination can justify fewer additional spaces: it also shortens the eventual walk.
        // Sideways or outward detours retain the stricter supply threshold.
        const supplyPerMinute = candidate.walkMinutes <= state.previous.walkMinutes - CIRCUIT_LIMITS.closerWalkImprovementMinutes
          ? CIRCUIT_LIMITS.minimumCloserSpacesPerDriveMinute : CIRCUIT_LIMITS.minimumSpacesPerDriveMinute;
        if (capacity < CIRCUIT_LIMITS.minimumCapacity || capacity / Math.max(1, minutes) < supplyPerMinute) continue;
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
        nextStates.push(next);
        explored.push(next);
      }
    }
    // Keep different street sets/endpoints and an objective-specific winner, not three copies of the same path.
    const beam = new Map<string, State>();
    for (let rank = 0; rank < 3; rank++) for (const strategy of strategies) {
      const sorted = [...nextStates].sort((a, b) => quality(b, strategy) - quality(a, strategy));
      const state = sorted[rank];
      if (!state) continue;
      const key = `${[...state.visited].sort().join("|")}>${state.previous.id}`;
      const previous = beam.get(key);
      if (!previous || quality(state) > quality(previous)) beam.set(key, state);
      if (beam.size >= 4) break;
    }
    frontier = [...beam.values()].slice(0, 4);
  }
  const results = new Map<string, State>();
  for (const strategy of strategies) {
    const sorted = [...explored].sort((a, b) => quality(b, strategy) - quality(a, strategy));
    for (const state of sorted.slice(0, 4)) {
      const key = state.stops.map(stop => stop.id).join(">");
      results.set(key, state);
    }
  }
  return [...results.values()].map(asRoute);
}

export async function buildSearchRoute(primary: Candidate, candidates: Candidate[], input: TripInput,
  signal: AbortSignal, options: CircuitOptions = {}): Promise<SearchRoute> {
  const routes = await buildSearchRouteOptions(primary, candidates, input, signal, options);
  return routes.sort((a, b) => circuitUtility({ ...primary, searchRoute: b }) - circuitUtility({ ...primary, searchRoute: a }))[0];
}
