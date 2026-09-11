import type { Coordinate, Inventory, Place, RouteData } from "../types";
export const GARNIER: Place = {
  label: "Palais Garnier · 8 rue Scribe, Paris",
  coordinates: [2.331232, 48.872666],
  postcode: "75009",
};
export const MONTREUIL: Place = {
  label: "Rue de Valmy, Montreuil",
  coordinates: [2.418937, 48.850843],
  postcode: "93100",
};
export async function fetchJSON<T>(
  url: string,
  signal?: AbortSignal,
): Promise<T> {
  const timeout = AbortSignal.timeout(18000),
    combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetch(url, { signal: combined });
  if (!response.ok)
    throw new Error(
      response.status === 429
        ? "The open routing service is busy. Please try again in a moment."
        : `The data service is temporarily unavailable (${response.status}). Please try again.`,
    );
  return response.json();
}
export async function geocode(
  query: string,
  signal?: AbortSignal,
): Promise<Place[]> {
  const presets = /garnier|op[ée]ra de paris/i.test(query) ? [GARNIER] : [];
  const data = await fetchJSON<{
    features: {
      geometry: { coordinates: Coordinate };
      properties: { label: string; postcode?: string; score: number };
    }[];
  }>(
    `https://data.geopf.fr/geocodage/search?${new URLSearchParams({ q: query, limit: "5" })}`,
    signal,
  );
  return [
    ...presets,
    ...data.features
      .filter((f) => f.properties.score > 0.4)
      .map((f) => ({
        label: f.properties.label,
        coordinates: f.geometry.coordinates,
        postcode: f.properties.postcode,
      })),
  ].slice(0, 5);
}
let inventoryPromise: Promise<Inventory> | null = null;
export function getInventory() {
  return (inventoryPromise ??= fetchJSON<Inventory>(
    `${import.meta.env.BASE_URL}data/parking.json?v=${encodeURIComponent(import.meta.env.VITE_INVENTORY_VERSION)}`,
  ).catch((error) => {
    inventoryPromise = null;
    throw error;
  }));
}
const routeCache = new Map<string, RouteData>();
let routeQueue: Promise<void> = Promise.resolve();
let lastRequest = 0;
export async function getRoute(
  start: Coordinate,
  end: Coordinate,
  profile: "car" | "pedestrian",
  signal?: AbortSignal,
): Promise<RouteData> {
  const key = `${profile}:${start.map((n) => n.toFixed(5))}:${end.map((n) => n.toFixed(5))}`;
  if (routeCache.has(key)) return routeCache.get(key)!;
  let release!: () => void;
  const previous = routeQueue;
  routeQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await previous;
    signal?.throwIfAborted();
    const wait = Math.max(0, 300 - (Date.now() - lastRequest));
    if (wait) await new Promise((r) => setTimeout(r, wait));
    signal?.throwIfAborted();
    lastRequest = Date.now();
    const params = new URLSearchParams({
      resource: "bdtopo-osrm",
      start: start.join(","),
      end: end.join(","),
      profile,
      optimization: "fastest",
      geometryFormat: "geojson",
      getSteps: "false",
      distanceUnit: "meter",
      timeUnit: "second",
    });
    const data = await fetchJSON<RouteData>(
      `https://data.geopf.fr/navigation/itineraire?${params}`,
      signal,
    );
    if (
      !Number.isFinite(data.duration) ||
      data.duration < 0 ||
      data.geometry?.type !== "LineString" ||
      !data.geometry.coordinates?.length
    )
      throw new Error("No usable route was found for this street.");
    if (routeCache.size > 200) routeCache.clear();
    routeCache.set(key, data);
    return data;
  } finally {
    release();
  }
}
export function navigationURL(
  provider: "google" | "waze",
  end: Coordinate,
  origin?: Coordinate,
  walking = false,
) {
  if (provider === "waze")
    return `https://waze.com/ul?${new URLSearchParams({ ll: `${end[1]},${end[0]}`, navigate: "yes", utm_source: "park-in-paris" })}`;
  const p = new URLSearchParams({
    api: "1",
    destination: `${end[1]},${end[0]}`,
    travelmode: walking ? "walking" : "driving",
  });
  if (origin) p.set("origin", `${origin[1]},${origin[0]}`);
  return `https://www.google.com/maps/dir/?${p}`;
}
