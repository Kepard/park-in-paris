import test from "node:test";
import assert from "node:assert/strict";
import { googleParkingRouteURL, parkingStops } from "../src/lib/navigation";
import type { Coordinate } from "../src/types";

const stops = [
  { street: "First", coordinates: [2.33, 48.87] as Coordinate, capacity: 20 },
  { street: "Second", coordinates: [2.331, 48.871] as Coordinate, capacity: 12 },
  { street: "Third", coordinates: [2.332, 48.872] as Coordinate, capacity: 15 },
  { street: "Fourth", coordinates: [2.333, 48.873] as Coordinate, capacity: 10 },
];

test("Google Maps includes the first street and three backups in order within mobile waypoint limits", () => {
  const plan = { ...stops[0], searchRoute: { stops } };
  const url = new URL(googleParkingRouteURL(plan, [2.42, 48.85]));
  assert.equal(url.searchParams.get("origin"), "48.85,2.42");
  assert.equal(url.searchParams.get("destination"), "48.873,2.333");
  assert.deepEqual(url.searchParams.get("waypoints")?.split("|"), ["48.87,2.33", "48.871,2.331", "48.872,2.332"]);
  assert.equal(url.searchParams.get("travelmode"), "driving");
  assert.equal(url.searchParams.get("api"), "1");
  assert.ok(url.href.length < 2048);
  assert.deepEqual(parkingStops(plan), stops);
});

test("old saved trips and empty search routes still open their starting street", () => {
  for (const plan of [stops[0], { ...stops[0], searchRoute: { stops: [] } }]) {
    const url = new URL(googleParkingRouteURL(plan, [2.42, 48.85]));
    assert.equal(url.searchParams.get("destination"), "48.87,2.33");
    assert.equal(url.searchParams.has("waypoints"), false);
    assert.deepEqual(parkingStops(plan), [plan]);
  }
});

test("a route with one backup still visits its starting street first", () => {
  const url = new URL(googleParkingRouteURL({ ...stops[0], searchRoute: { stops: stops.slice(0, 2) } }, [2.42, 48.85]));
  assert.equal(url.searchParams.get("waypoints"), "48.87,2.33");
  assert.equal(url.searchParams.get("destination"), "48.871,2.331");
});
