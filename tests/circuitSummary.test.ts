import test from "node:test";
import assert from "node:assert/strict";
import { circuitSummary } from "../src/lib/circuitSummary";
import { tripSchema } from "../server/schema";
import type { Candidate, Coordinate, SearchStop } from "../src/types";

const coordinates: Coordinate = [2.33, 48.87];
const route = { duration: 60, distance: 150, geometry: { type: "LineString" as const, coordinates: [coordinates, coordinates] } };
const arrival = "2026-09-21T16:30:00.000Z";
const bay = { id: "first", street: "First", coordinates, arrondissement: 9, capacity: 10, kind: "paid" as const, customHours: false };
const primary: Candidate = {
  id: bay.id, street: bay.street, coordinates, arrondissement: 9, bays: [bay], capacity: 10, sharedCapacity: 0,
  drive: route, walk: route, driveMinutes: 30, walkMinutes: 3, searchLow: 2, searchHigh: 8,
  totalLow: 35, totalHigh: 41, total: 38, arrival, learnedFrom: 0, reason: "Test", parkingType: "paid",
};
const first: SearchStop = {
  id: bay.id, street: bay.street, coordinates, arrondissement: 9, bays: [bay], capacity: 10,
  sharedCapacity: 0, walk: route, walkMinutes: 3, parkingType: "paid", arrivalLow: arrival, arrivalHigh: arrival,
  totalLow: 35, totalHigh: 41,
};

test("circuit totals include every street rather than the starting street alone", () => {
  const second = { ...first, id: "second", street: "Second", bays: [{ ...bay, id: "second", capacity: 30 }],
    capacity: 30, walkMinutes: 7, driveFromPrevious: { ...route, distance: 450 }, totalLow: 42, totalHigh: 55 };
  const summary = circuitSummary({ ...primary, searchRoute: { stops: [first, second], capacity: 40, extraDriveMinutes: 2, totalLow: 35, totalHigh: 55 } });
  assert.deepEqual(summary, { capacity: 40, streetCount: 2, driveMinutes: 2, driveMetres: 450, walkMin: 3, walkMax: 7,
    walkWeighted: 6, totalLow: 35, totalHigh: 55 });
});

test("mapped supply never counts the same parking section twice", () => {
  const summary = circuitSummary({ ...primary, searchRoute: { stops: [first, first], capacity: 20, extraDriveMinutes: 0, totalLow: 35, totalHigh: 41 } });
  assert.equal(summary.capacity, 10);
});

test("circuit strategy survives validation and legacy saved plans remain supported", () => {
  const trip = { id: "15bc050e-125b-43b9-b187-d8241e4f9f84", createdAt: arrival, status: "active", modelVersion: "test",
    input: { origin: { label: "Origin", coordinates }, destination: { label: "Destination", coordinates },
      departure: "2026-09-21T18:00", returnAt: "2026-09-21T22:00", maxWalk: 30, rushAllowance: true, useExperience: false },
    candidate: primary };
  for (const strategy of ["balanced", "closest", "more-spaces"] as const) {
    const restored = tripSchema.parse({ ...trip, candidate: { ...primary, circuit: { strategy } } });
    assert.deepEqual(restored.candidate.circuit, { strategy });
  }
  assert.equal(tripSchema.safeParse(trip).success, true);
  assert.equal(tripSchema.safeParse({ ...trip, candidate: { ...primary, circuit: { strategy: "guaranteed" } } }).success, false);
  const summary = circuitSummary(primary);
  assert.equal(summary.capacity, 10);
  assert.equal(summary.streetCount, 1);
  assert.equal(summary.walkMin, 3);
});
