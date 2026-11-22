import type { Bay, Coordinate, Inventory } from "../types.js";

// Fixed columns avoid repeating property names in the citywide HTTP response.
type Section = [string, string, number, Coordinate, number, Bay["kind"], boolean];
export type ParkingFeed = Omit<Inventory, "bays"> & { sections: Section[] };

export function packInventory({ bays, ...metadata }: Inventory): ParkingFeed {
  return { ...metadata, sections: bays.map(b => [b.id, b.street, b.arrondissement, b.coordinates, b.capacity, b.kind, b.customHours]) };
}

export function unpackInventory({ sections, ...metadata }: ParkingFeed): Inventory {
  return { ...metadata, bays: sections.map(([id, street, arrondissement, coordinates, capacity, kind, customHours]) =>
    ({ id, street, arrondissement, coordinates, capacity, kind, customHours })) };
}
