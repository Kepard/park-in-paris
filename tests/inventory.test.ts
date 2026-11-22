import test from "node:test";
import assert from "node:assert/strict";
import { parkingSections } from "../server/parkingInventory";
import { getInventory } from "../src/lib/api";
import { packInventory, unpackInventory } from "../src/lib/inventoryFormat";
import type { Inventory } from "../src/types";

const street = {
  id: "51354", id_old: null, regpri: "PAYANT MIXTE", regpar: "Mixte", plarel: 4, placal: 6,
  typevoie: "AV", nomvoie: "MOZART", arrond: 16, geo_point_2d: { lon: 2.268, lat: 48.851 },
};
const metadata = { updated: "2026-11-22T06:20:27.000Z", source: "Paris", license: "ODbL-1.0" };

test("city districts include Auteuil while excluding both Bois and permanently reserved bays", () => {
  const delivery = { ...street, id: "2", regpri: "LIVRAISON", regpar: "ZL périodique", plage_hor1_fin: "18:00" };
  const sections = parkingSections([street, delivery, { ...street, arrond: 21 }, { ...street, arrond: 22 },
    { ...delivery, regpar: "ZL permanente" }, { ...street, plarel: 0 }]);
  assert.equal(sections.length, 2);
  assert.ok(sections.some(b => b.capacity === 4 && b.kind === "paid"));
  assert.ok(sections.some(b => b.kind === "shared" && b.customHours));
});

test("section IDs and grouping order survive reordered exports with old and new city identifiers", () => {
  const old = { ...street, id: null, id_old: "51354" };
  const sections = parkingSections([old, street]);
  assert.deepEqual(sections, parkingSections([street, old]));
  assert.equal(new Set(sections.map(b => b.id)).size, 2);
  assert.throws(() => parkingSections([street, street]), /duplicate/i);
  assert.throws(() => parkingSections([{ ...old, id_old: null }]), /identifier/i);
});

test("the public feed preserves every planner field and the source publication date", () => {
  const inventory: Inventory = { ...metadata, bays: parkingSections([street]) };
  const feed = packInventory(inventory);
  const { sourceRegime, sourceUse, ...expected } = parkingSections([street])[0];
  assert.deepEqual(unpackInventory(feed), { ...metadata, bays: [expected] });
  assert.equal(feed.sections[0].length, 7);
});

test("a feed outage uses the dated bundle and a later search retries the public feed", async t => {
  const inventory = { ...metadata, bays: parkingSections([street]) };
  const feed = packInventory({ ...inventory, bays: Array(1000).fill(inventory.bays[0]) });
  let now = Date.now(), available = false;
  const calls: string[] = [];
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "fetch", async (url: string) => {
    calls.push(url);
    if (url.endsWith("api/inventory")) return available ? Response.json(feed) : new Response(null, { status: 503 });
    return Response.json(inventory);
  });
  const bundled = "2026-09-11T21:37:46.875Z";
  assert.deepEqual(await getInventory("/", bundled), inventory);
  assert.equal(calls.length, 2);
  now += 301000; available = true;
  assert.deepEqual(await getInventory("/", bundled), unpackInventory(feed));
  assert.equal(calls.length, 3);
  await getInventory("/", bundled);
  assert.equal(calls.length, 3);
});
