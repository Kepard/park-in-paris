import type { SavedTrip } from "../types";
const KEY = "park-in-paris.trips.v1";
export function readTrips(): SavedTrip[] {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(value)
      ? value.filter(
          (t) =>
            t?.id &&
            t?.candidate?.coordinates &&
            t?.input?.returnAt &&
            ["active", "completed"].includes(t.status),
        )
      : [];
  } catch {
    return [];
  }
}
export function saveTrips(trips: SavedTrip[]) {
  localStorage.setItem(KEY, JSON.stringify(trips.slice(0, 100)));
}
export function exportTrips(trips: SavedTrip[]) {
  const blob = new Blob(
    [
      JSON.stringify(
        { schemaVersion: 1, exportedAt: new Date().toISOString(), trips },
        null,
        2,
      ),
    ],
    { type: "application/json" },
  );
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "park-in-paris-trips.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
