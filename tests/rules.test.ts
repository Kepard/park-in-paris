import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  eligible,
  holidays,
  parseParis,
  parisInput,
  sharedAllowed,
} from "../src/lib/rules";
import { groupsFor, searchEstimate } from "../src/lib/planner";
import { navigationURL } from "../src/lib/api";
import type { Bay, SavedTrip } from "../src/types";
const at = parseParis;
test("the shipped inventory contains only supported car and shared-delivery categories", () => {
  const inventory = JSON.parse(readFileSync(new URL("../public/data/parking.json", import.meta.url), "utf8"));
  const supported: Record<string, string> = { "PAYANT MIXTE": "Mixte", "PAYANT ROTATIF": "Rotatif", "GRATUIT": "Gratuit", "LIVRAISON": "ZL périodique" };
  assert.ok(inventory.bays.length > 1000);
  for (const bay of inventory.bays) {
    assert.equal(supported[bay.sourceRegime], bay.sourceUse, bay.id);
    assert.ok(Object.hasOwn(supported, bay.sourceRegime));
  }
});
test("shared delivery bays must be eligible for the complete interval", () => {
  const cases: [string, string, boolean][] = [
    ["2026-09-14T19:59", "2026-09-14T22:00", false],
    ["2026-09-14T20:00", "2026-09-14T22:00", true],
    ["2026-09-14T20:00", "2026-09-15T07:00", true],
    ["2026-09-14T20:00", "2026-09-15T07:01", false],
    ["2026-09-13T14:00", "2026-09-14T06:59", true],
    ["2026-09-13T14:00", "2026-09-14T07:01", false],
    ["2026-04-05T14:00", "2026-04-06T12:00", true],
    ["2026-09-14T20:00", "2026-09-14T20:00", false],
  ];
  for (const [start, end, allowed] of cases)
    assert.equal(
      sharedAllowed(at(start), at(end)),
      allowed,
      `${start} → ${end}`,
    );
});
test("Paris input conversion is timezone independent and rejects nonexistent clock times", () => {
  assert.equal(
    at("2026-09-14T18:00").toISOString(),
    "2026-09-14T16:00:00.000Z",
  );
  assert.equal(
    at("2026-01-05T18:00").toISOString(),
    "2026-01-05T17:00:00.000Z",
  );
  assert.throws(() => at("2026-03-29T02:30"));
  assert.throws(() => at("2026-02-30T20:00"));
  assert.equal(parisInput(at("2026-10-25T02:30")), "2026-10-25T02:30");
  assert.equal(
    sharedAllowed(at("2026-03-28T20:00"), at("2026-03-30T07:00")),
    true,
  );
});
test("national holiday calendar includes Easter-dependent dates and year boundaries", () => {
  const h = holidays(2026);
  for (const date of ["2026-04-06", "2026-05-14", "2026-05-25", "2026-12-25"])
    assert.ok(h.has(date));
  assert.equal(
    sharedAllowed(at("2026-12-31T20:00"), at("2027-01-01T22:00")),
    true,
  );
});
test("custom hours, zero capacity and long paid stays are rejected", () => {
  const bay: Bay = {
    id: "x",
    street: "Rue Test",
    coordinates: [2.33, 48.87],
    arrondissement: 9,
    capacity: 3,
    kind: "paid",
    customHours: false,
  };
  assert.equal(
    eligible(bay, at("2026-09-14T18:00"), at("2026-09-14T22:00")),
    true,
  );
  assert.equal(
    eligible(
      { ...bay, capacity: 0 },
      at("2026-09-14T18:00"),
      at("2026-09-14T22:00"),
    ),
    false,
  );
  assert.equal(
    eligible(
      { ...bay, customHours: true },
      at("2026-09-14T18:00"),
      at("2026-09-14T22:00"),
    ),
    false,
  );
  assert.equal(
    eligible(bay, at("2026-09-14T15:00"), at("2026-09-14T22:00")),
    false,
  );
});
test("learning waits for enough relevant successes and keeps abandoned searches out", () => {
  const arrival = at("2026-09-14T18:00");
  const trip = (outcome: string, minutes: number) =>
    ({
      candidate: { street: "Rue Test" },
      survey: {
        outcome,
        bayType: "ordinary",
        searchMinutes: minutes,
        observedArrival: arrival.toISOString(),
      },
    }) as SavedTrip;
  const baseline = searchEstimate(15, arrival, 9, [], "Rue Test", true);
  assert.deepEqual(
    searchEstimate(
      15,
      arrival,
      9,
      [trip("here", 0), trip("here", 0)],
      "Rue Test",
      true,
    ),
    baseline,
  );
  const sundayTrips = Array.from({ length: 3 }, () => ({ ...trip("here", 0), survey: { ...trip("here", 0).survey!, observedArrival: at("2026-09-13T18:00").toISOString() } }));
  assert.deepEqual(searchEstimate(15, arrival, 9, sundayTrips, "Rue Test", true), baseline);
  const unsupported = Array.from({ length: 3 }, () => ({ ...trip("here", 0), survey: { ...trip("here", 0).survey!, bayType: "other" as const } }));
  assert.deepEqual(searchEstimate(15, arrival, 9, unsupported, "Rue Test", true), baseline);
  assert.equal(
    searchEstimate(
      15,
      arrival,
      9,
      [trip("here", 0), trip("here", 0), trip("here", 0)],
      "Rue Test",
      true,
    ).learnedFrom,
    3,
  );
  assert.deepEqual(
    searchEstimate(
      15,
      arrival,
      9,
      [trip("gave-up", 80), trip("gave-up", 80), trip("gave-up", 80)],
      "Rue Test",
      true,
    ),
    baseline,
  );
  assert.deepEqual(
    searchEstimate(
      15,
      arrival,
      9,
      [trip("here", 0), trip("here", 0), trip("here", 0)],
      "Rue Test",
      false,
    ),
    baseline,
  );
});
test("a reserved delivery bay does not hide ordinary spaces on the same stretch", () => {
  const common: Bay = { id: "delivery", street: "Rue Test", coordinates: [2.3312, 48.8726], arrondissement: 9, capacity: 2, kind: "shared", customHours: false };
  const inventory = { updated: "2026-09-11", source: "test", license: "ODbL", bays: [common, { ...common, id: "ordinary", kind: "paid" as const, capacity: 39 }] };
  const place = { label: "Garnier", coordinates: common.coordinates };
  const groups = groupsFor(inventory, { origin: place, destination: place, departure: "2026-09-14T18:00", returnAt: "2026-09-14T22:00", maxWalk: 30, rushAllowance: true, useExperience: false });
  assert.equal(groups[0].id, "ordinary");
  assert.equal(groups[0].capacity, 39);
  assert.equal(groups[0].bays.length, 2);
});
test("navigation links use latitude-longitude in Google/Waze and walking mode when requested", () => {
  const waze = new URL(navigationURL("waze", [2.33, 48.87]));
  assert.equal(waze.searchParams.get("ll"), "48.87,2.33");
  assert.equal(waze.searchParams.get("navigate"), "yes");
  const google = new URL(
    navigationURL("google", [2.33, 48.87], [2.42, 48.85], true),
  );
  assert.equal(google.searchParams.get("destination"), "48.87,2.33");
  assert.equal(google.searchParams.get("origin"), "48.85,2.42");
  assert.equal(google.searchParams.get("travelmode"), "walking");
});
