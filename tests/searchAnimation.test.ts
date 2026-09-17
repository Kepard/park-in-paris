import test from "node:test";
import assert from "node:assert/strict";
import { destinationSearchTraces } from "../src/lib/searchAnimation";
import type { Coordinate, SearchTrace } from "../src/types";

const destination: Coordinate = [2.33, 48.87];
const at = (east: number, north = 0): Coordinate => [
  destination[0] + east / (111_320 * Math.cos(destination[1] * Math.PI / 180)),
  destination[1] + north / 111_320,
];
const trace = (id: string, coordinates: Coordinate[]): SearchTrace => ({ id, geometry: { type: "LineString", coordinates } });

test("destination exploration follows actual walks inward and crops the remote approach", () => {
  const points = [at(1_500), at(400), at(400, 200), destination];
  const original = structuredClone(points);
  const result = destinationSearchTraces([trace("walk:street", points)], destination, 1_000);
  assert.equal(result.length, 1);
  const path = result[0].geometry.coordinates;
  assert.ok(Math.abs(path[0][0] - at(1_000)[0]) < 1e-8);
  assert.deepEqual(path[1], at(400));
  assert.deepEqual(path[2], at(400, 200));
  assert.deepEqual(path.at(-1), destination);
  assert.deepEqual(points, original, "rendering must not mutate the saved route");
});

test("local animation prioritizes walks instead of duplicating long drive-and-walk traces", () => {
  const result = destinationSearchTraces([
    trace("direct", [at(-5_000), destination]),
    trace("street", [at(-5_000), at(500), destination]),
    trace("walk:street", [at(500), destination]),
  ], destination);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "local:walk:street:0");
  assert.deepEqual(result[0].geometry.coordinates, [at(500), destination]);
});

test("a route leaving and re-entering the local view keeps only its connected arrival leg", () => {
  const result = destinationSearchTraces([
    trace("walk:loop", [destination, at(2_000), at(2_000, 500), at(200, 500)]),
  ], destination, 1_000);
  assert.equal(result.length, 1);
  const path = result[0].geometry.coordinates;
  assert.equal(path.length, 2, "do not join the earlier section with an invented street");
  assert.ok(Math.abs(path[0][0] - at(1_000)[0]) < 1e-8);
  assert.equal(path[0][1], destination[1]);
  assert.deepEqual(path.at(-1), destination);
});

test("the direct route provides a local fallback while the first street is being routed", () => {
  const result = destinationSearchTraces([trace("direct", [at(-5_000), destination])], destination, 1_000);
  assert.equal(result.length, 1);
  assert.ok(Math.abs(result[0].geometry.coordinates[0][0] - at(-1_000)[0]) < 1e-8);
  assert.deepEqual(result[0].geometry.coordinates.at(-1), destination);
  assert.deepEqual(destinationSearchTraces([trace("remote", [at(5_000), at(6_000)])], destination), []);
});

test("outward route geometry reverses without adding a connector to the destination marker", () => {
  const snappedDestination = at(20, 10);
  const points = [snappedDestination, at(150, 100), at(700, 100)];
  const original = structuredClone(points);
  const result = destinationSearchTraces([trace("walk:reversed", points)], destination, 1_000);
  assert.deepEqual(result[0].geometry.coordinates, [...original].reverse());
  assert.deepEqual(points, original, "reversing an incoming ray must not mutate its source route");
});

test("a crossing route with no local endpoint cannot masquerade as an arrival", () => {
  assert.deepEqual(destinationSearchTraces([
    trace("remote-crossing", [at(-2_000), at(2_000)]),
  ], destination, 1_000), []);
});
