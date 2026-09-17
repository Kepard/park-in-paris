import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { Map, GeoJSONSource, ExpressionSpecification } from "maplibre-gl";
import type { Coordinate, SearchTrace } from "../types";
import { destinationSearchTraces } from "../lib/searchAnimation";

const COLORS = ["#315944", "#799d71", "#bdd879", "#4f8068", "#94b780", "#416751", "#b0ce77", "#67967e"];
const empty = () => ({ type: "FeatureCollection" as const, features: [] });
const rgba = (hex: string, alpha: number) => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${alpha})`;

type Slot = { id: string; color: string; trace?: SearchTrace; started: number; travel: number; cumulative: number[]; length: number };

// Interpolate only between consecutive vertices of the actual routed street polyline.
function headPosition(slot: Slot, progress: number): Coordinate {
  const coordinates = slot.trace!.geometry.coordinates;
  const distance = slot.length * Math.min(1, Math.max(0, progress));
  let index = 1;
  while (index < slot.cumulative.length - 1 && slot.cumulative[index] < distance) index++;
  const from = coordinates[index - 1];
  const to = coordinates[index];
  const fraction = (distance - slot.cumulative[index - 1]) / (slot.cumulative[index] - slot.cumulative[index - 1] || 1);
  return [from[0] + (to[0] - from[0]) * fraction, from[1] + (to[1] - from[1]) * fraction];
}

function gradient(points: [number, string][]): ExpressionSpecification {
  const stops: (string | number)[] = [];
  // MapLibre requires strictly increasing stops, including at the ends of a pulse.
  for (const [position, color] of points) {
    const bounded = Math.max(0, Math.min(1, position));
    if (stops.length && bounded <= Number(stops[stops.length - 2])) continue;
    stops.push(bounded, color);
  }
  if (stops.length === 2) stops.push(1, stops[1]);
  return ["interpolate", ["linear"], ["line-progress"], ...stops] as ExpressionSpecification;
}

export function useSearchRays(
  mapRef: RefObject<Map | null>, ready: boolean, active: boolean, traces: SearchTrace[],
  phase: "journey" | "streets", destination?: Coordinate,
) {
  const local = phase === "streets";
  const paths = useMemo(() => local && destination ? destinationSearchTraces(traces, destination) : traces,
    [traces, local, destination]);
  const latest = useRef(paths);
  latest.current = paths;
  const redraw = useRef<((now: number) => void) | null>(null);
  const [reduced, setReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !active) return;
    map.addSource("search-network", { type: "geojson", data: empty() });
    map.addLayer({
      id: "search-network", type: "line", source: "search-network",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#527b51", "line-width": local ? 2 : 1.5, "line-opacity": reduced ? .5 : .15 },
    });
    const slots: Slot[] = Array.from({ length: local ? 12 : COLORS.length }, (_, index) => {
      const color = COLORS[index % COLORS.length];
      const id = `search-ray-${index}`;
      map.addSource(id, { type: "geojson", lineMetrics: true, data: empty() });
      map.addLayer({
        id: `${id}-glow`, type: "line", source: id,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": color, "line-width": local ? 15 : 12, "line-opacity": .2, "line-blur": 5 },
      });
      map.addLayer({
        id: `${id}-bed`, type: "line", source: id,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": color, "line-width": 2.5, "line-opacity": reduced ? .8 : .33 },
      });
      map.addLayer({
        id, type: "line", source: id,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": color, "line-width": local ? 4.5 : 4, "line-opacity": reduced ? 0 : .95 },
      });
      return { id, color, started: 0, travel: 0, cumulative: [], length: 0 };
    });
    map.addSource("search-ray-heads", { type: "geojson", data: empty() });
    map.addLayer({
      id: "search-ray-heads-glow", type: "circle", source: "search-ray-heads",
      paint: { "circle-radius": 14, "circle-color": ["get", "color"], "circle-blur": .9, "circle-opacity": .4 },
    });
    map.addLayer({
      id: "search-ray-heads", type: "circle", source: "search-ray-heads",
      paint: { "circle-radius": 3.4, "circle-color": "#f1ffcd", "circle-stroke-color": ["get", "color"], "circle-stroke-width": 1.6 },
    });
    let frame = 0;
    let previous = 0;
    let renderedPaths: SearchTrace[] | undefined;
    const draw = (now: number) => {
      if (renderedPaths !== latest.current) {
        renderedPaths = latest.current;
        (map.getSource("search-network") as GeoJSONSource).setData({
          type: "FeatureCollection",
          features: renderedPaths.map((trace) => ({ type: "Feature", properties: {}, geometry: trace.geometry })),
        });
      }
      const available = latest.current.filter((trace) => trace.geometry.coordinates.length > 1);
      const visible = local ? available : available.slice(-slots.length);
      const visibleIds = new Set(visible.map((trace) => trace.id));
      for (const slot of slots) {
        // Let an incoming ray reach the destination before replacing it with another nearby street.
        const finished = !reduced && now >= slot.started + slot.travel + 900;
        if (slot.trace && (local && !reduced ? finished : !visibleIds.has(slot.trace.id))) {
          slot.trace = undefined;
          (map.getSource(slot.id) as GeoJSONSource).setData(empty());
        }
      }
      const pending = visible.filter((trace) => !slots.some((slot) => slot.trace?.id === trace.id));
      slots.forEach((slot, index) => {
        if (slot.trace || !pending.length) return;
        const [trace] = pending.splice(local && !reduced ? Math.floor(Math.random() * pending.length) : 0, 1);
        slot.trace = trace;
        slot.started = now + (local ? Math.random() * 900 : index * 55);
        slot.cumulative = [0];
        slot.length = 0;
        const points = trace.geometry.coordinates;
        for (let point = 1; point < points.length; point++) {
          // The same Mercator distances used by MapLibre's line-progress keep heads on their trails.
          const mercatorY = (latitude: number) => Math.log(Math.tan(Math.PI / 4 + latitude * Math.PI / 360));
          slot.length += Math.hypot((points[point][0] - points[point - 1][0]) * Math.PI / 180, mercatorY(points[point][1]) - mercatorY(points[point - 1][1]));
          slot.cumulative.push(slot.length);
        }
        slot.travel = local ? Math.max(2300, Math.min(6200, slot.length * 6378137 * .658 / 210 * 1000)) : 3100 + index * 130;
        (map.getSource(slot.id) as GeoJSONSource).setData({ type: "Feature", properties: {}, geometry: trace.geometry });
      });
      if (reduced) return;
      const heads = slots.flatMap((slot) => {
        if (!slot.trace) return [];
        const elapsed = now - slot.started;
        const clear = rgba(slot.color, 0);
        if (elapsed < 0) {
          const hidden = gradient([[0, clear], [1, clear]]);
          for (const layer of [slot.id, `${slot.id}-bed`, `${slot.id}-glow`]) map.setPaintProperty(layer, "line-gradient", hidden);
          return [];
        }
        // Nearby streets send staggered arrivals toward the destination along real route geometry.
        const travel = slot.travel;
        const reveal = Math.min(1, elapsed / travel);
        const head = local ? elapsed / travel : elapsed < travel ? reveal : ((elapsed - travel) % (travel + 900)) / travel;
        const bed = gradient([[0, slot.color], [Math.max(.0001, reveal - .018), slot.color], [Math.max(.0002, reveal), clear], [1, clear]]);
        map.setPaintProperty(`${slot.id}-bed`, "line-gradient", reveal >= 1 ? ["interpolate", ["linear"], ["line-progress"], 0, slot.color, 1, slot.color] : bed);
        map.setPaintProperty(`${slot.id}-glow`, "line-gradient", gradient([[0, clear], [head - .32, clear], [head - .11, rgba(slot.color, .6)], [head - .018, slot.color], [head + .018, clear], [1, clear]]));
        map.setPaintProperty(slot.id, "line-gradient", gradient([[0, clear], [head - .25, clear], [head - .08, rgba(slot.color, .5)], [head - .004, slot.color], [head + .008, clear], [1, clear]]));
        if (head <= 0 || head > 1) return [];
        return [{ type: "Feature" as const, properties: { color: slot.color }, geometry: { type: "Point" as const, coordinates: headPosition(slot, head) } }];
      });
      (map.getSource("search-ray-heads") as GeoJSONSource).setData({ type: "FeatureCollection", features: heads });
    };
    redraw.current = draw;
    draw(performance.now());
    const tick = (now: number) => {
      if (now - previous >= 40) { previous = now; draw(now); }
      frame = requestAnimationFrame(tick);
    };
    if (!reduced) frame = requestAnimationFrame(tick);
    return () => {
      redraw.current = null;
      cancelAnimationFrame(frame);
      for (const id of ["search-ray-heads", "search-ray-heads-glow"]) if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource("search-ray-heads")) map.removeSource("search-ray-heads");
      for (const { id } of slots) {
        for (const layer of [id, `${id}-bed`, `${id}-glow`]) if (map.getLayer(layer)) map.removeLayer(layer);
        if (map.getSource(id)) map.removeSource(id);
      }
      if (map.getLayer("search-network")) map.removeLayer("search-network");
      if (map.getSource("search-network")) map.removeSource("search-network");
    };
  }, [mapRef, ready, active, reduced, local]);

  // Reduced-motion rendering is event-driven: new real routes appear without an animation loop.
  useEffect(() => { redraw.current?.(performance.now()); }, [paths]);
}
