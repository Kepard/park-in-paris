import { mkdir, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { readParisInventory } from "../server/parkingInventory.ts";

const inventory = await readParisInventory(AbortSignal.timeout(120000));
await mkdir("public/data", { recursive: true });
const temp = `public/data/parking-${randomUUID()}.tmp`;
await writeFile(temp, JSON.stringify(inventory));
await rename(temp, "public/data/parking.json");
const spaces = inventory.bays.reduce((sum, bay) => sum + bay.capacity, 0);
console.log(`Paris data dated ${inventory.updated}: ${inventory.bays.length} sections, ${spaces} mapped spaces.`);
