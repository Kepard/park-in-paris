import test from "node:test";
import assert from "node:assert/strict";
import { geocode, getRoute, ServiceUnavailableError } from "../src/lib/api";
import type { Coordinate } from "../src/types";

test("matching a street named Garnier does not select the opera house", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ features: [] }));
  assert.deepEqual(await geocode("rue Garnier"), []);
  assert.match((await geocode("Palais Garnier"))[0].label, /Palais Garnier/);
});

test("queued duplicate routes share a response and a larger search keeps recent routes", async t => {
  let requests = 0, clock = Date.now();
  t.mock.method(Date, "now", () => clock += 1000);
  const start: Coordinate = [2.33, 48.87], end: Coordinate = [2.34, 48.86];
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    return Response.json({ distance: 10, duration: 1, geometry: { type: "LineString", coordinates: [start, end] } });
  });
  await Promise.all([getRoute(start, end, "car"), getRoute(start, end, "car")]);
  assert.equal(requests, 1);
  for (let i = 1; i <= 220; i++) await getRoute([2.33 + i / 10000, 48.87], end, "car");
  await getRoute(start, end, "car");
  assert.equal(requests, 221);
  await getRoute(end, start, "car");
  await getRoute(start, end, "pedestrian");
  assert.equal(requests, 223);
  await assert.rejects(getRoute(start, end, "car", AbortSignal.abort()), { name: "AbortError" });
});

test("a rate-limited route fails explicitly and is retried after service recovery", async t => {
  const start: Coordinate = [2.4, 48.85], end: Coordinate = [2.41, 48.86];
  let available = false, clock = Date.now();
  t.mock.method(Date, "now", () => clock += 1000000);
  t.mock.method(globalThis, "fetch", async () => available
    ? Response.json({ duration: 20, distance: 75, geometry: { type: "LineString", coordinates: [start, end] } })
    : new Response(null, { status: 429 }));
  await assert.rejects(getRoute(start, end, "car"), ServiceUnavailableError);
  available = true;
  assert.equal((await getRoute(start, end, "car")).distance, 75);
});
