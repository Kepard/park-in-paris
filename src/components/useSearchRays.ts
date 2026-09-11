import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { Map, GeoJSONSource } from "maplibre-gl";
import type { SearchTrace } from "../types";

const COLORS = ["#00a6c7", "#f08d35", "#9363ef", "#40b87b", "#e85995", "#2e8cfa", "#e9b62f", "#59bfb7"];
const empty = () => ({ type: "FeatureCollection" as const, features: [] });

export function useSearchRays(mapRef: RefObject<Map | null>, ready: boolean, active: boolean, traces: SearchTrace[]) {
  const latest = useRef(traces);
  latest.current = traces;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !active) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const slots = COLORS.map((color, i) => {
      const id = `search-ray-${i}`;
      map.addSource(id, { type: "geojson", lineMetrics: true, data: empty() });
      map.addLayer({ id: `${id}-bed`, type: "line", source: id, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": color, "line-width": 7, "line-opacity": .07, "line-blur": 1 } });
      map.addLayer({ id, type: "line", source: id, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": color, "line-width": 4.5, "line-opacity": reduced ? .7 : 1 } });
      return { id, color, traceId: "" };
    });
    let frame = 0, previous = 0;
    const started = performance.now();
    const draw = (now: number) => {
      if (now - previous >= 40) {
        previous = now;
        const visible = latest.current.slice(-COLORS.length);
        slots.forEach((slot, i) => {
          const trace = visible[i];
          if (!trace) return;
          if (slot.traceId !== trace.id) {
            (map.getSource(slot.id) as GeoJSONSource).setData({ type: "Feature", properties: {}, geometry: trace.geometry });
            slot.traceId = trace.id;
          }
          if (reduced) return;
          // Each pulse advances along the routed polyline; its transparent tail never cuts across blocks.
          const head = (((now - started) / (5400 + i * 230) + i * .12) % 1) * 1.26;
          const start = Math.max(0, Math.min(.999, head - .26));
          const bright = Math.max(start + .0001, Math.min(.9994, head - .04));
          const end = Math.max(bright + .0001, Math.min(1, head));
          map.setPaintProperty(slot.id, "line-gradient", ["interpolate", ["linear"], ["line-progress"], start, "rgba(255,255,255,0)", bright, slot.color, end, "rgba(255,255,255,0)"]);
        });
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      for (const { id } of slots) {
        if (map.getLayer(id)) map.removeLayer(id);
        if (map.getLayer(`${id}-bed`)) map.removeLayer(`${id}-bed`);
        if (map.getSource(id)) map.removeSource(id);
      }
    };
  }, [mapRef, ready, active]);
}
