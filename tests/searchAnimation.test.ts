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

test("destination exploration reverses actual walks and crops the remote approach", () => {
  const points = [at(1_500), at(400), at(400, 200), destination];
  const original = structuredClone(points);
  const result = destinationSearchTraces([trace("walk:street", points)], destination, 1_000);
  assert.equal(result.length, 1);
  const path = result[0].geometry.coordinates;
  assert.deepEqual(path[0], destination);
  assert.deepEqual(path[1], at(400, 200));
  assert.deepEqual(path[2], at(400));
  assert.ok(Math.abs(path.at(-1)![0] - at(1_000)[0]) < 1e-8);
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
  assert.deepEqual(result[0].geometry.coordinates, [destination, at(500)]);
});

test("a route leaving and re-entering the local view is not joined by an invented street", () => {
  const result = destinationSearchTraces([
    trace("walk:loop", [destination, at(2_000), at(2_000, 500), at(200, 500)]),
  ], destination, 1_000);
  assert.equal(result.length, 2);
  assert.ok(result[0].geometry.coordinates.at(-1)![1] < result[1].geometry.coordinates[0][1]);
  assert.deepEqual(result[1].geometry.coordinates.at(-1), at(200, 500));
});

test("the direct route provides a local fallback while the first street is being routed", () => {
  const result = destinationSearchTraces([trace("direct", [at(-5_000), destination])], destination, 1_000);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].geometry.coordinates[0], destination);
  assert.ok(Math.abs(result[0].geometry.coordinates.at(-1)![0] - at(-1_000)[0]) < 1e-8);
  assert.deepEqual(destinationSearchTraces([trace("remote", [at(5_000), at(6_000)])], destination), []);
});
