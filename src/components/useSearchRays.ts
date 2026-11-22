import { useEffect, useMemo, useRef, type RefObject } from "react";
import type { Map as StreetMap } from "maplibre-gl";
import type { Coordinate, SearchTrace } from "../types";
import { destinationSearchTraces } from "../lib/searchAnimation";

const svgNS = "http://www.w3.org/2000/svg";
const colors = ["#27553e", "#668b57", "#92ad4f", "#41785b", "#799c68", "#568563"];

export function useSearchRays(
  mapRef: RefObject<StreetMap | null>, ready: boolean, active: boolean, traces: SearchTrace[],
  phase: "journey" | "streets", destination?: Coordinate,
) {
  const paths = useMemo(() => phase === "streets" && destination
    ? destinationSearchTraces(traces, destination) : traces, [traces, phase, destination]);
  const latest = useRef(paths);
  const refresh = useRef<(() => void) | null>(null);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !active) return;

    // Project the actual routes when the camera moves. The browser can animate the strokes
    // without re-evaluating the base map's hundreds of style layers on every frame.
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", "search-paths");
    const network = document.createElementNS(svgNS, "g");
    const moving = document.createElementNS(svgNS, "g");
    svg.append(network, moving);
    map.getCanvas().after(svg);

    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const routes = new Map<string, SVGPathElement>();
    const rays = new Map<string, SVGPathElement>();
    let frame = 0;

    function fillRays(finished?: string) {
      if (media.matches || !svg.isConnected) return;
      const available = [...routes.keys()].filter(id => !rays.has(id));
      // Prefer a new street when one is ready, but continue if only one route has arrived.
      if (finished && available.length > 1) {
        const i = available.indexOf(finished);
        if (i >= 0) available.splice(i, 1);
      }
      while (rays.size < 8 && available.length) {
        const id = available.splice(Math.floor(Math.random() * available.length), 1)[0];
        const ray = routes.get(id)!.cloneNode(false) as SVGPathElement;
        ray.setAttribute("class", "search-ray");
        ray.setAttribute("pathLength", "1");
        ray.style.animationDuration = `${2.6 + Math.random() * 1.8}s`;
        ray.style.animationDelay = `${Math.random() * .65}s`;
        rays.set(id, ray);
        ray.addEventListener("animationend", () => {
          rays.delete(id);
          ray.remove();
          fillRays(id);
        }, { once: true });
        moving.append(ray);
      }
    }
    function draw() {
      const visible = latest.current.filter(trace => trace.geometry.coordinates.length > 1);
      const ids = new Set(visible.map(trace => trace.id));
      for (const [id, path] of routes) {
        if (ids.has(id)) continue;
        routes.delete(id); path.remove();
        rays.get(id)?.remove(); rays.delete(id);
      }
      for (const [index, trace] of visible.entries()) {
        let path = routes.get(trace.id);
        if (!path) {
          path = document.createElementNS(svgNS, "path");
          path.setAttribute("stroke", colors[index % colors.length]);
          network.append(path); routes.set(trace.id, path);
        }
        const d = trace.geometry.coordinates.map((coordinate, i) => {
          const point = map!.project(coordinate);
          return `${i ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`;
        }).join(" ");
        path.setAttribute("d", d);
        rays.get(trace.id)?.setAttribute("d", d);
      }
      if (media.matches) { moving.replaceChildren(); rays.clear(); }
      else fillRays();
    }
    function schedule() {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; draw(); });
    }
    refresh.current = schedule;
    map.on("move", schedule);
    map.on("resize", schedule);
    media.addEventListener("change", schedule);
    schedule();
    return () => {
      refresh.current = null;
      map.off("move", schedule); map.off("resize", schedule);
      media.removeEventListener("change", schedule);
      cancelAnimationFrame(frame);
      svg.remove();
    };
  }, [mapRef, ready, active, phase]);

  useEffect(() => {
    latest.current = paths;
    refresh.current?.();
  }, [paths]);
}
