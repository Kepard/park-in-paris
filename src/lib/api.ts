import type { Coordinate, Inventory, Place, RouteData } from "../types";
import { unpackInventory, type ParkingFeed } from "./inventoryFormat";
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
export class ServiceUnavailableError extends Error {}

export async function fetchJSON<T>(
  url: string,
  signal?: AbortSignal,
): Promise<T> {
  const timeout = AbortSignal.timeout(18000),
    combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetch(url, { signal: combined, credentials: "omit" });
  } catch {
    signal?.throwIfAborted();
    throw new ServiceUnavailableError("The data service could not be reached. Check your connection and try again.");
  }
  if (response.status === 429 || [502, 503, 504].includes(response.status))
    throw new ServiceUnavailableError("The data service is busy. Please try again in a moment.");
  if (!response.ok)
    throw new Error(`The data service could not complete this request (${response.status}).`);
  try {
    return await response.json();
  } catch (error) {
    signal?.throwIfAborted();
    if (timeout.aborted) throw new ServiceUnavailableError("The data service timed out. Please try again.");
    throw error;
  }
}
export async function geocode(
  query: string,
  signal?: AbortSignal,
  parisOnly = false,
): Promise<Place[]> {
  const presets = /^(?:garnier|palais garnier|op[ée]ra (?:garnier|de paris))(?:,? paris)?$/i.test(query.trim()) ? [GARNIER] : [];
  const data = await fetchJSON<{
    features: {
      geometry: { coordinates: Coordinate };
      properties: { label?: string; toponym?: string; city?: string | string[]; postcode?: string | string[]; score?: number };
    }[];
  }>(
    `https://data.geopf.fr/geocodage/search?${new URLSearchParams({ q: query, index: "address,poi", limit: "8", lon: "2.35", lat: "48.86", ...(parisOnly ? { depcode: "75" } : {}) })}`,
    signal,
  ).catch(error => {
    signal?.throwIfAborted();
    if (presets.length) return { features: [] };
    throw error;
  });
  return [
    ...presets,
    ...data.features
      .filter((f) => (f.properties.score ?? 1) > 0.4 && (f.properties.label || f.properties.toponym))
      .map((f) => ({
        label: f.properties.label || [f.properties.toponym, Array.isArray(f.properties.city) ? f.properties.city[0] : f.properties.city].filter(Boolean).join(" · "),
        coordinates: f.geometry.coordinates,
        postcode: Array.isArray(f.properties.postcode) ? f.properties.postcode[0] : f.properties.postcode,
      })),
  ].filter((p, i, all) => all.findIndex(other => other.label === p.label) === i).slice(0, 5);
}
let inventoryPromise: Promise<Inventory> | null = null;
let inventoryExpires = 0;
export function getInventory(base = import.meta.env.BASE_URL, bundledDate = import.meta.env.VITE_INVENTORY_VERSION) {
  if (inventoryPromise && Date.now() < inventoryExpires) return inventoryPromise;
  inventoryExpires = Date.now() + 86400000;
  inventoryPromise = (async () => {
    try {
      const feed = await fetchJSON<ParkingFeed>(`${base}api/inventory`, AbortSignal.timeout(8000));
      if (Array.isArray(feed.sections) && feed.sections.length >= 1000 && Date.parse(feed.updated) >= Date.parse(bundledDate))
        return unpackInventory(feed);
    } catch { /* A slow or unavailable city feed can fall back to the bundled inventory. */ }
    inventoryExpires = Date.now() + 300000;
    return fetchJSON<Inventory>(`${base}data/parking.json?v=${encodeURIComponent(bundledDate)}`);
  })().catch(error => { inventoryPromise = null; throw error; });
  return inventoryPromise;
}
const routeCache = new Map<string, { route: RouteData; expires: number }>();
const MAX_CACHED_ROUTES = 512;
// IGN permits five starts per second. Leave headroom for timing jitter.
const ROUTE_INTERVAL_MS = 225;
let routeQueue: Promise<void> = Promise.resolve();
let lastRequest = 0;
export async function getRoute(
  start: Coordinate,
  end: Coordinate,
  profile: "car" | "pedestrian",
  signal?: AbortSignal,
): Promise<RouteData> {
  signal?.throwIfAborted();
  const key = `${profile}:${start}:${end}`;
  let release!: () => void;
  const previous = routeQueue;
  routeQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await previous;
    signal?.throwIfAborted();
    const cached = routeCache.get(key);
    if (cached && cached.expires > Date.now()) {
      routeCache.delete(key);
      routeCache.set(key, cached);
      return cached.route;
    }
    const wait = Math.min(ROUTE_INTERVAL_MS, Math.max(0, ROUTE_INTERVAL_MS - (Date.now() - lastRequest)));
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
      !Number.isFinite(data.distance) || data.distance < 0 ||
      data.geometry?.type !== "LineString" ||
      !data.geometry.coordinates?.length
    )
      throw new Error("No usable route was found for this street.");
    const route = { duration: data.duration, distance: data.distance, geometry: data.geometry };
    if (routeCache.size >= MAX_CACHED_ROUTES) routeCache.delete(routeCache.keys().next().value!);
    routeCache.set(key, { route, expires: Date.now() + 86400000 });
    return route;
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
export function streetViewURL(coordinates: Coordinate) {
  return `https://www.google.com/maps/@?${new URLSearchParams({ api: "1", map_action: "pano", viewpoint: `${coordinates[1]},${coordinates[0]}` })}`;
}
