import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildSearchRoute, createCircuitRoutingBudget, rankSearchRoutes } from "../src/lib/searchCircuit";
import { BACKUP_DISCOVERY_LIMITS, groupsFor, searchEstimate } from "../src/lib/planner";
import { parseParis } from "../src/lib/rules";
import { tripSchema } from "../server/schema";
import type { Candidate, Coordinate, RouteData, SavedTrip, TripInput } from "../src/types";

const place = { label: "Test destination", coordinates: [2.33, 48.87] as Coordinate };
const input: TripInput = {
  origin: place, destination: place, departure: "2026-09-14T18:00", returnAt: "2026-09-14T22:00",
  maxWalk: 20, rushAllowance: false, useExperience: false,
};
const route = (a: Coordinate, b: Coordinate, duration = 60, distance = 150): RouteData =>
  ({ duration, distance, geometry: { type: "LineString", coordinates: [a, b] } });
function candidate(id: string, index: number, capacity = 20): Candidate {
  const coordinates: Coordinate = [2.33 + index * 0.001, 48.87];
  return {
    id, street: `Rue ${id}`, arrondissement: 9, coordinates,
    bays: [{ id, street: `Rue ${id}`, arrondissement: 9, coordinates, capacity, kind: "paid", customHours: false }],
    capacity, sharedCapacity: 0, drive: route(place.coordinates, coordinates, 600, 3000),
    walk: route(coordinates, place.coordinates, 300, 350), driveMinutes: 10, walkMinutes: 5,
    searchLow: 2, searchHigh: 5, totalLow: 17, totalHigh: 20, total: 18.5,
    arrival: parseParis("2026-09-14T18:10").toISOString(), learnedFrom: 0, reason: "Test", parkingType: "paid",
  };
}
const signal = () => new AbortController().signal;

test("circuits respect one-way routing and choose a short directed alternative", async () => {
  const a = candidate("A", 0), b = candidate("B", 1, 100), c = candidate("C", 2, 30);
  const calls: string[] = [];
  const result = await buildSearchRoute(a, [a, b, c], input, signal(), { route: async (from, to, profile) => {
    assert.equal(profile, "car");
    const name = `${from[0].toFixed(3)}>${to[0].toFixed(3)}`;
    calls.push(name);
    return route(from, to, from === a.coordinates && to === b.coordinates ? 900 : 60);
  } });
  assert.deepEqual(result.stops.map(stop => stop.id), ["A", "C", "B"]);
  assert.ok(calls.includes("2.330>2.331"));
  assert.ok(calls.includes("2.332>2.331"));
  assert.equal(result.capacity, 150);
  assert.equal(result.extraDriveMinutes, 2);
  assert.equal(result.totalLow, 17);
  assert.equal(result.totalHigh, 32);
  assert.deepEqual(result.stops[2].driveFromPrevious?.geometry.coordinates, [c.coordinates, b.coordinates]);
});

test("five nearby eligible streets produce at most three backups without double-counting capacity", async () => {
  const candidates = ["A", "B", "C", "D", "E"].map((id, index) => candidate(id, index));
  const result = await buildSearchRoute(candidates[0], candidates, input, signal(), {
    route: async (from, to) => route(from, to, 30, 100),
  });
  assert.equal(result.stops.length, 4);
  assert.equal(new Set(result.stops.map(stop => stop.id)).size, 4);
  assert.equal(result.capacity, 80);
  assert.equal(result.extraDriveMinutes, 1.5);
});

test("three backups remain the default when the highest-capacity street is a directed dead end", async () => {
  const candidates = [candidate("A", 0), candidate("B", 1, 100), candidate("C", 2, 30), candidate("D", 3, 25), candidate("E", 4, 20)];
  const ids = new Map(candidates.map(c => [c.coordinates, c.id]));
  const usable = new Set(["A>B", "A>C", "C>D", "D>E"]);
  const calls: string[] = [];
  const routingBudget = createCircuitRoutingBudget();
  const options = { routingBudget, route: async (from: Coordinate, to: Coordinate) => {
    const edge = `${ids.get(from)}>${ids.get(to)}`;
    calls.push(edge);
    return route(from, to, usable.has(edge) ? 60 : 900);
  } };
  const result = await buildSearchRoute(candidates[0], candidates, input, signal(), options);
  assert.deepEqual(result.stops.map(stop => stop.id), ["A", "C", "D", "E"]);
  assert.equal(result.extraDriveMinutes, 3);
  assert.ok(calls.includes("A>B"));
  assert.ok(calls.includes("B>C"));
  assert.ok(calls.length <= 16);
  assert.equal(new Set(calls).size, calls.length);
  const before = calls.length;
  await buildSearchRoute(candidates[0], candidates, input, signal(), options);
  assert.equal(calls.length, before, "rechecking a plan reuses directed-route results");
});

test("circuit suggestions share a hard global routing budget", async () => {
  const candidates = [candidate("A", 0), candidate("B", 1), candidate("C", 2), candidate("D", 3)];
  const routingBudget = createCircuitRoutingBudget();
  routingBudget.remaining = 2;
  let calls = 0;
  for (const primary of candidates) await buildSearchRoute(primary, candidates, input, signal(), {
    routingBudget, route: async (from, to) => { calls++; return route(from, to); },
  });
  assert.equal(calls, 2);
  assert.equal(routingBudget.remaining, 0);
});

test("circuits bound both per-leg and cumulative detours and never repeat a street", async () => {
  const candidates = [candidate("A", 0), candidate("B", 1), candidate("C", 2), candidate("D", 3)];
  const duplicate = { ...candidate("B2", 1.2, 200), street: "Rue A" };
  const result = await buildSearchRoute(candidates[0], [...candidates, duplicate], input, signal(), {
    route: async (from, to) => route(from, to, 180, 900),
  });
  assert.equal(result.stops.length, 3); // A third leg would exceed the 2.4 km total cap.
  assert.equal(result.extraDriveMinutes, 6);
  assert.equal(new Set(result.stops.map(stop => stop.street)).size, result.stops.length);
  assert.equal(result.capacity, 60);
  const tooLong = await buildSearchRoute(candidates[0], candidates, input, signal(), {
    route: async (from, to) => route(from, to, 60, 1500),
  });
  assert.equal(tooLong.stops.length, 1);
});

test("backup streets respect the user's walking limit and stay close to the first street's walk", async () => {
  const a = candidate("A", 0), overLimit = { ...candidate("B", 1, 200), walkMinutes: 21 },
    furtherAway = { ...candidate("C", 2, 200), walkMinutes: 14 }, allowed = { ...candidate("D", 3), walkMinutes: 9 };
  const calls: Coordinate[] = [];
  const result = await buildSearchRoute(a, [a, overLimit, furtherAway, allowed], input, signal(), {
    route: async (from, to) => { calls.push(to); return route(from, to); },
  });
  assert.deepEqual(result.stops.map(stop => stop.id), ["A", "D"]);
  assert.deepEqual(calls, [allowed.coordinates]);
});

test("assumed earlier searching never unlocks reserved delivery capacity", async () => {
  const a = { ...candidate("A", 0), drive: route(place.coordinates, place.coordinates, 300), driveMinutes: 5, searchHigh: 20 };
  const b = candidate("B", 1, 6);
  b.bays.push({ ...b.bays[0], id: "delivery", capacity: 50, kind: "shared" });
  b.capacity = 56;
  b.sharedCapacity = 50;
  const result = await buildSearchRoute(a, [a, b], { ...input, departure: "2026-09-14T19:50" }, signal(), {
    route: async (from, to) => route(from, to),
  });
  const stop = result.stops[1];
  assert.equal(stop.capacity, 6);
  assert.equal(stop.sharedCapacity, 0);
  assert.equal(stop.arrivalLow, parseParis("2026-09-14T19:56").toISOString());
  assert.equal(stop.arrivalHigh, parseParis("2026-09-14T20:16").toISOString());
  assert.equal(result.capacity, 26);
});

test("backup stages must leave time to return to the car and remain legal for the whole stay", async () => {
  const a = candidate("A", 0), b = candidate("B", 1);
  const shortVisit = await buildSearchRoute(a, [a, b], { ...input, returnAt: "2026-09-14T18:25" }, signal(), {
    route: async (from, to) => route(from, to),
  });
  assert.equal(shortVisit.stops.length, 1);
  const delivery = { ...b, bays: [{ ...b.bays[0], kind: "shared" as const }] };
  const crossesMorning = await buildSearchRoute(a, [a, delivery], { ...input, departure: "2026-09-14T23:00", returnAt: "2026-09-15T07:01" }, signal(), {
    route: async (from, to) => route(from, to),
  });
  assert.equal(crossesMorning.stops.length, 1);
});

test("routing failures preserve a usable first street; cancellation propagates", async () => {
  const a = candidate("A", 0), b = candidate("B", 1);
  const result = await buildSearchRoute(a, [a, b], input, signal(), { route: async () => { throw new Error("Offline"); } });
  assert.equal(result.stops.length, 1);
  assert.equal(result.capacity, a.capacity);
  const controller = new AbortController();
  await assert.rejects(buildSearchRoute(a, [a, b], input, controller.signal, { route: async () => {
    controller.abort(); throw controller.signal.reason;
  } }), { name: "AbortError" });
});

test("low-capacity detours do not pad a circuit and useful backups can outweigh a small delay", async () => {
  const a = candidate("A", 0), b = candidate("B", 1, 2), c = candidate("C", 2, 8), d = candidate("D", 3, 30);
  const circuit = await buildSearchRoute(a, [a, b, c, d], input, signal(), { route: async (from, to) => route(from, to, 240, 500) });
  assert.deepEqual(circuit.stops.map(stop => stop.id), ["A", "D"]);
  const fast = { ...a, total: 20 }, fallback = { ...d, total: 22, searchRoute: circuit };
  assert.equal(rankSearchRoutes([fast, fallback])[0].id, "D");
  assert.equal(rankSearchRoutes([fast, { ...fallback, total: 26 }])[0].id, "A");
});

test("nearby inventory discovery includes streets outside the initial shortlist with a bounded budget", () => {
  const a = candidate("A", 0);
  const bays = Array.from({ length: 30 }, (_, index) => candidate(`local-${index}`, (index % 5 + 1) * 0.2, index + 1).bays[0]);
  const inventory = { updated: "2026-09-14", source: "Test", license: "Test", bays };
  const initial = groupsFor(inventory, input);
  const excluded = new Set(initial.map(group => group.id));
  const backups = groupsFor(inventory, input, [a], excluded);
  assert.ok(backups.length > 0);
  assert.ok(backups.length <= BACKUP_DISCOVERY_LIMITS.total);
  assert.ok(backups.every(group => !excluded.has(group.id)));
});

test("nearby discovery gives each of three starting streets three backups and one spare", () => {
  const anchors = [candidate("start-1", -8), candidate("start-2", 8), candidate("start-3", 24)];
  const bays = anchors.flatMap((anchor, anchorIndex) => Array.from({ length: 6 }, (_, index) => ({
    ...candidate(`local-${anchorIndex}-${index}`, 0, 20 + index).bays[0],
    coordinates: [anchor.coordinates[0] + (index + 1) * 0.0002, anchor.coordinates[1]] as Coordinate,
  })));
  const inventory = { updated: "2026-09-14", source: "Test", license: "Test", bays };
  const backups = groupsFor(inventory, { ...input, maxWalk: 30 }, anchors);
  assert.equal(backups.length, 12);
  for (let index = 0; index < anchors.length; index++)
    assert.equal(backups.filter(group => group.id.startsWith(`local-${index}-`)).length, 4);
});

test("saved circuit and exact parked stop survive validation while older trips remain valid", async () => {
  const a = candidate("A", 0), b = candidate("B", 1);
  a.searchRoute = await buildSearchRoute(a, [a, b], input, signal(), { route: async (from, to) => route(from, to) });
  const trip: SavedTrip = { id: randomUUID(), createdAt: new Date().toISOString(), status: "completed", input, candidate: a,
    modelVersion: "test", survey: { outcome: "here", searchMinutes: 5, streetsTried: 2, bayType: "ordinary", note: "", submittedAt: new Date().toISOString(),
      actualStreet: b.street, parkedStopId: b.id, observedArrival: a.arrival } };
  const restored = tripSchema.parse(JSON.parse(JSON.stringify(trip)));
  assert.deepEqual(restored.candidate.searchRoute, a.searchRoute);
  assert.equal(restored.survey?.parkedStopId, b.id);
  const legacy = structuredClone(trip);
  delete legacy.candidate.searchRoute;
  delete legacy.survey!.parkedStopId;
  assert.equal(tripSchema.safeParse(legacy).success, true);
  const trips = Array.from({ length: 3 }, () => trip);
  assert.equal(searchEstimate(20, new Date(a.arrival), 9, trips, a.street, true, a.coordinates).learnedFrom, 0);
  const firstStopTrips = trips.map(t => ({ ...t, survey: { ...t.survey!, streetsTried: 1, parkedStopId: a.id, actualStreet: a.street } }));
  assert.equal(searchEstimate(20, new Date(a.arrival), 9, firstStopTrips, a.street, true, a.coordinates).learnedFrom, 3);
});
