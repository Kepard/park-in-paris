import { useCallback, useEffect, useRef, useState } from "react";
import type { SavedTrip } from "../types";
import { readTrips, saveTrips as cacheTrips } from "./storage";

const OUTBOX = "park-in-paris.outbox.v1";
const MIGRATED = "park-in-paris.server-migration.v1";
type Change = { id: string; trip: SavedTrip | null; revision: string };
function pending(): Change[] {
  try { const value = JSON.parse(localStorage.getItem(OUTBOX) || "[]"); return Array.isArray(value) ? value : []; } catch { return []; }
}
function enqueue(changes: Change[]) {
  const queue = new Map(pending().map(c => [c.id, c]));
  changes.forEach(c => queue.set(c.id, c));
  localStorage.setItem(OUTBOX, JSON.stringify([...queue.values()]));
}
function acknowledge(change: Change) {
  localStorage.setItem(OUTBOX, JSON.stringify(pending().filter(c => c.id !== change.id || c.revision !== change.revision)));
}
async function request(method = "GET", change?: Change): Promise<{ trips: SavedTrip[]; newHistory?: boolean }> {
  const url = `${import.meta.env.BASE_URL}api/trips${method === "DELETE" ? `?id=${encodeURIComponent(change!.id)}` : ""}`;
  const response = await fetch(url, {
    method, credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(20000),
    headers: { "Content-Type": "application/json", "X-Park-Client": "1" },
    ...(method === "PUT" ? { body: JSON.stringify(change!.trip) } : {}),
  });
  if (!response.ok) {
    const message = await response.json().catch(() => null);
    throw new Error(message?.error || "Server sync is unavailable. Your changes are saved on this device.");
  }
  return response.json();
}

export function useTripStore() {
  const [trips, setTrips] = useState<SavedTrip[]>(readTrips);
  const [status, setStatus] = useState<"syncing" | "saved" | "offline">("syncing");
  const [error, setError] = useState("");
  const current = useRef(trips), inFlight = useRef(false), revision = useRef(0), alive = useRef(true);
  const syncRef = useRef<() => void>(() => {});
  const sync = useCallback(async () => {
    if (inFlight.current || !alive.current) return;
    inFlight.current = true;
    setStatus("syncing"); setError("");
    let failed = false;
    try {
      const cycle = async () => {
      const initial = await request(); // Establish the private HttpOnly cookie before any mutation.
      if (initial.newHistory || !localStorage.getItem(MIGRATED)) {
        const alreadyPending = new Set(pending().map(c => c.id));
        enqueue(readTrips().filter(t => !alreadyPending.has(t.id)).map(trip => ({ id: trip.id, trip, revision: crypto.randomUUID() })));
        localStorage.setItem(MIGRATED, "1");
      }
      for (let count = 0; count < 250; count++) {
        const change = pending().sort((a, b) => Number(!!a.trip) - Number(!!b.trip))[0];
        if (!change) break;
        await request(change.trip ? "PUT" : "DELETE", change);
        acknowledge(change);
      }
      const version = revision.current;
      const remote = await request();
      if (!Array.isArray(remote.trips)) throw new Error("Invalid server response");
      if (!pending().length && version === revision.current) {
        cacheTrips(remote.trips); current.current = remote.trips;
        if (alive.current) { setTrips(remote.trips); setStatus("saved"); }
      }
      };
      // The lock also covers cookie creation, preventing two first-open tabs from creating competing histories.
      if (navigator.locks) await navigator.locks.request("park-in-paris-trip-sync", cycle);
      else await cycle();
    } catch (e) {
      failed = true;
      if (alive.current) { setStatus("offline"); setError((e as Error).message); }
    } finally {
      inFlight.current = false;
      if (!failed && pending().length && alive.current) queueMicrotask(() => syncRef.current());
    }
  }, []);
  syncRef.current = () => { void sync(); };
  const saveTrips = useCallback((next: SavedTrip[]) => {
    const limited = next.slice(0, 100), previous = current.current;
    const changes: Change[] = limited.filter(t => JSON.stringify(previous.find(p => p.id === t.id)) !== JSON.stringify(t)).map(trip => ({ id: trip.id, trip, revision: crypto.randomUUID() }));
    previous.filter(t => !limited.some(n => n.id === t.id)).forEach(t => changes.push({ id: t.id, trip: null, revision: crypto.randomUUID() }));
    enqueue(changes);
    cacheTrips(limited);
    current.current = limited; revision.current++;
    setTrips(limited); setStatus("syncing");
    void sync();
  }, [sync]);
  useEffect(() => {
    alive.current = true;
    const retry = () => { void sync(); };
    const storage = (e: StorageEvent) => { if (e.key === OUTBOX) retry(); };
    void sync();
    window.addEventListener("online", retry);
    window.addEventListener("focus", retry);
    window.addEventListener("storage", storage);
    return () => { alive.current = false; window.removeEventListener("online", retry); window.removeEventListener("focus", retry); window.removeEventListener("storage", storage); };
  }, [sync]);
  return { trips, saveTrips, status, error, sync };
}
