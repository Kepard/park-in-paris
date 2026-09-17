import test from "node:test";
import assert from "node:assert/strict";
import type { Candidate, Coordinate, SearchStop } from "../src/types";
import { circuitUtility, selectCircuitChoices, similarCircuits } from "../src/lib/circuitRanking";
import { circuitSeeds } from "../src/lib/planner";

function circuit(id: string, capacity: number, walk: number, drive = 3, streets = [id + "1", id + "2", id + "3", id + "4"]): Candidate {
  const coordinates: Coordinate = [2.33, 48.87];
  const route = { duration: 60, distance: 200, geometry: { type: "LineString" as const, coordinates: [coordinates, coordinates] } };
  const stops: SearchStop[] = streets.map((street, index) => ({
    id: street, street, arrondissement: 9, coordinates, capacity: capacity / streets.length, sharedCapacity: 0,
    bays: [{ id: street, street, arrondissement: 9, coordinates, capacity: capacity / streets.length, kind: "paid", customHours: false }],
    walk: { ...route, duration: walk * 60 }, walkMinutes: walk, parkingType: "paid",
    arrivalLow: "2026-09-21T16:15:00Z", arrivalHigh: "2026-09-21T16:20:00Z", totalLow: 20 + walk, totalHigh: 40 + walk,
    ...(index ? { driveFromPrevious: { ...route, duration: drive / (streets.length - 1) * 60, distance: drive * 150 / (streets.length - 1) } } : {}),
  }));
  return { ...stops[0], id, drive: route, driveMinutes: 10, searchLow: 3, searchHigh: 8, total: 25,
    arrival: stops[0].arrivalLow, learnedFrom: 0, reason: "Test", searchRoute: { stops, capacity, extraDriveMinutes: drive, totalLow: 20 + walk, totalHigh: 40 + walk } };
}

test("a better whole circuit beats the better isolated starting street", () => {
  const fastStart = { ...circuit("fast", 24, 7), total: 15, capacity: 20 };
  const richCircuit = { ...circuit("rich", 120, 8), total: 28, capacity: 8 };
  assert.ok(circuitUtility(richCircuit) > circuitUtility(fastStart));
  assert.equal(selectCircuitChoices([fastStart, richCircuit])[0].id, "rich");
});

test("distinct balanced, closer and space-rich choices reflect full-circuit tradeoffs", () => {
  const balanced = circuit("gold", 100, 9), closest = circuit("close", 40, 4, 2), abundant = circuit("abundant", 180, 18, 4);
  const choices = selectCircuitChoices([abundant, closest, balanced]);
  assert.deepEqual(choices.map(candidate => candidate.circuit?.strategy), ["balanced", "closest", "more-spaces"]);
  assert.deepEqual(choices.map(candidate => candidate.id), ["gold", "close", "abundant"]);
});

test("reversed streets and heavily overlapping circuits do not create duplicate choices", () => {
  const balanced = circuit("gold", 100, 9);
  const reversed = circuit("reverse", 100, 9, 3, ["gold4", "gold3", "gold2", "gold1"]);
  assert.ok(similarCircuits(balanced, reversed));
  assert.equal(selectCircuitChoices([balanced, reversed]).length, 1);
  const shortWalkPrefix = circuit("prefix", 40, 4, 1, ["gold1", "gold2"]);
  assert.equal(similarCircuits(balanced, shortWalkPrefix), false);
  assert.ok(selectCircuitChoices([balanced, shortWalkPrefix]).some(candidate => candidate.circuit?.strategy === "closest"));
});

test("dominated circuits and misleading strategy labels are omitted", () => {
  const balanced = circuit("gold", 100, 9);
  const worse = circuit("worse", 80, 12, 5);
  const longerWalk = circuit("long", 80, 10, 2);
  const noSupplyGain = circuit("same", 105, 15, 3);
  const choices = selectCircuitChoices([balanced, worse, longerWalk, noSupplyGain]);
  assert.deepEqual(choices.map(candidate => candidate.circuit?.strategy), ["balanced"]);
});

test("a low-capacity final street cannot hide a long worst-case walk behind a short average", () => {
  const balanced = circuit("gold", 100, 9);
  const misleading = circuit("uneven", 80, 3);
  misleading.searchRoute!.stops.at(-1)!.walkMinutes = 20;
  assert.equal(selectCircuitChoices([balanced, misleading]).some(candidate => candidate.circuit?.strategy === "closest"), false);
});

test("seed selection explores neighborhood opportunity instead of only isolated start time", () => {
  const small = circuit("small", 10, 2), near = circuit("near", 20, 6), far = circuit("far", 100, 15);
  small.coordinates = [2.330, 48.87]; small.capacity = 10; small.total = 12;
  near.coordinates = [2.335, 48.87]; near.capacity = 20; near.total = 18;
  far.coordinates = [2.345, 48.87]; far.capacity = 100; far.total = 35;
  assert.ok(circuitSeeds([small, near, far]).includes(far));
  assert.equal(circuitSeeds([small, near, far])[0].id, "small");
});
