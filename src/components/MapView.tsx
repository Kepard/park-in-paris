import { useCallback, useEffect, useRef, useState } from "react";
import { Focus, LocateFixed, Route } from "lucide-react";
import * as maplibregl from "maplibre-gl";
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Bay, Candidate, Coordinate, Plan, Place, SearchTrace } from "../types";
import { CIRCUIT_LABELS, circuitSummary } from "../lib/circuitSummary";
import { useSearchRays } from "./useSearchRays";
import "./map-experience.css";

maplibregl.setWorkerUrl(mapWorkerUrl);
const empty = () => ({ type: "FeatureCollection" as const, features: [] });
const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const stopsFor = (candidate: Candidate) => candidate.searchRoute?.stops ?? [candidate];

function padding(map: maplibregl.Map, detail = false) {
  const small = map.getContainer().clientHeight < 440;
  return {
    top: small ? 52 : 86, bottom: small ? 30 : 70,
    left: small ? 32 : 64, right: detail ? 64 : small ? 42 : 76,
  };
}

function fitCoordinates(map: maplibregl.Map, points: Coordinate[], detail = false) {
  if (!points.length) return;
  const bounds = new maplibregl.LngLatBounds();
  points.forEach((point) => bounds.extend(point));
  map.fitBounds(bounds, {
    padding: padding(map, detail),
    duration: reduceMotion() ? 0 : detail ? 1050 : 1150,
    maxZoom: detail ? 18 : 15.4,
  });
}

function bayDetails(bay: Bay) {
  const content = document.createElement("div");
  content.className = "parking-bay-details";
  const heading = document.createElement("strong");
  heading.textContent = `${bay.capacity} mapped ${bay.capacity === 1 ? "space" : "spaces"}`;
  const street = document.createElement("span");
  street.textContent = bay.street;
  const kind = document.createElement("p");
  kind.textContent = bay.kind === "shared"
    ? "Shared delivery bay · eligible for your planned stay. Check the signs."
    : bay.kind === "free" ? "Free public-road parking section." : "Paid public-road parking section.";
  const note = document.createElement("small");
  note.textContent = "Mapped capacity, not live availability. Each marker represents a parking section.";
  content.append(heading, street, kind, note);
  return content;
}

export function MapView({
  plan, selected, selectedStop, focusRequest, focusMode, onSelect, onSelectStop,
  destination, origin, searching, searchPhase, traces,
}: {
  plan: Plan | null;
  selected: number;
  selectedStop: number;
  focusRequest: number;
  focusMode: "circuit" | "street";
  onSelect: (i: number) => void;
  onSelectStop: (i: number) => void;
  destination: Place | null;
  origin: Place | null;
  searching: boolean;
  searchPhase: "journey" | "streets";
  traces: SearchTrace[];
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const camera = useRef({ plan: null as Plan | null, focusRequest: -1, selected: -1, selectedStop: -1 });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<"circuit" | "street">("circuit");
  const candidate = searching ? undefined : plan?.candidates[selected];
  const stops = candidate ? stopsFor(candidate) : [];
  const focused = stops[selectedStop] ?? stops[0];
  useSearchRays(mapRef, ready, searching, traces, searchPhase, destination?.coordinates);

  useEffect(() => {
    if (!container.current) return;
    setError(false);
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: container.current,
        style: "https://data.geopf.fr/annexes/ressources/vectorTiles/styles/PLAN.IGN/attenue.json",
        center: [2.349, 48.869], zoom: 13.25,
        cooperativeGestures: matchMedia("(pointer: coarse)").matches,
        attributionControl: { compact: false, customAttribution: '<a href="https://cartes.gouv.fr/" target="_blank" rel="noopener">© IGN</a>' },
      });
    } catch {
      setError(true);
      return;
    }
    mapRef.current = map;
    // A failed style download is asynchronous. Keep the planner usable while allowing a retry.
    const loadTimeout = window.setTimeout(() => setError(true), 20000);
    const resize = new ResizeObserver(() => map.resize());
    resize.observe(container.current);
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    const updateDetail = () => map.getContainer().classList.toggle("show-parking-labels", map.getZoom() >= 15.6);
    map.on("zoom", updateDetail);
    map.on("load", () => {
      clearTimeout(loadTimeout);
      setError(false);
      map.addSource("routes", { type: "geojson", data: empty() });
      map.addLayer({
        id: "drive-shadow", type: "line", source: "routes",
        filter: ["!=", ["get", "kind"], "walk"],
        paint: { "line-color": "#fffefb", "line-width": 10, "line-opacity": 0.95 },
        layout: { "line-cap": "round", "line-join": "round" },
      });
      map.addLayer({
        id: "drive", type: "line", source: "routes", filter: ["==", ["get", "kind"], "drive"],
        paint: { "line-color": "#8b9d91", "line-width": 3, "line-opacity": 0.45 },
        layout: { "line-cap": "round", "line-join": "round" },
      });
      map.addLayer({
        id: "search-circuit", type: "line", source: "routes", filter: ["==", ["get", "kind"], "circuit"],
        paint: { "line-color": "#234d3d", "line-width": 5, "line-opacity": 0.95 },
        layout: { "line-cap": "round", "line-join": "round" },
      });
      map.addLayer({
        id: "walk", type: "line", source: "routes", filter: ["==", ["get", "kind"], "walk"],
        paint: { "line-color": "#79973f", "line-width": 4, "line-dasharray": [1, 1.6] },
        layout: { "line-cap": "round" },
      });
      map.addSource("parking", { type: "geojson", data: empty() });
      map.addLayer({
        id: "parking-spots", type: "circle", source: "parking",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 3, 17, 7],
          "circle-color": ["case", ["get", "focused"], "#416347", "#8eaa77"],
          "circle-stroke-width": 2, "circle-stroke-color": "#fffefb", "circle-opacity": 0.9,
        },
      });
      updateDetail();
      setReady(true);
    });
    return () => {
      clearTimeout(loadTimeout);
      resize.disconnect();
      markers.current.forEach((marker) => marker.remove());
      popupRef.current?.remove();
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, [attempt]);

  const showCircuit = useCallback(() => {
    const map = mapRef.current;
    const chosen = plan?.candidates[selected];
    if (!map || !ready || !chosen) return;
    const routeStops = stopsFor(chosen);
    const points: Coordinate[] = [];
    routeStops.forEach((stop) => {
      points.push(stop.coordinates, ...stop.bays.map((bay) => bay.coordinates));
      if ("driveFromPrevious" in stop && stop.driveFromPrevious)
        points.push(...stop.driveFromPrevious.geometry.coordinates);
    });
    if (destination) points.push(destination.coordinates);
    fitCoordinates(map, points);
    popupRef.current?.remove();
    setView("circuit");
  }, [ready, plan, selected, destination]);

  const showStreet = useCallback(() => {
    const map = mapRef.current;
    const chosen = plan?.candidates[selected];
    if (!map || !ready || !chosen) return;
    const routeStops = stopsFor(chosen);
    const stop = routeStops[selectedStop] ?? routeStops[0];
    fitCoordinates(map, stop.bays.length ? stop.bays.map((bay) => bay.coordinates) : [stop.coordinates], true);
    popupRef.current?.remove();
    setView("street");
  }, [ready, plan, selected, selectedStop]);

  // Data updates never move the camera. Only a new plan or an explicit selection does.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    markers.current.forEach((marker) => marker.remove());
    markers.current = [];
    popupRef.current?.remove();
    const chosen = searching ? undefined : plan?.candidates[selected];
    const routeStops = chosen ? stopsFor(chosen) : [];
    const currentStop = routeStops[selectedStop] ?? routeStops[0];
    const lines = chosen ? [
      ...(view === "street" ? [{ type: "Feature" as const, properties: { kind: "drive" }, geometry: chosen.drive.geometry }] : []),
      ...routeStops.flatMap((stop) => "driveFromPrevious" in stop && stop.driveFromPrevious
        ? [{ type: "Feature" as const, properties: { kind: "circuit" }, geometry: stop.driveFromPrevious.geometry }] : []),
      { type: "Feature" as const, properties: { kind: "walk" }, geometry: currentStop.walk.geometry },
    ] : [];
    (map.getSource("routes") as maplibregl.GeoJSONSource).setData({ type: "FeatureCollection", features: lines });
    (map.getSource("parking") as maplibregl.GeoJSONSource).setData({
      type: "FeatureCollection",
      features: routeStops.flatMap((stop, index) => stop.bays.map((bay) => ({
        type: "Feature" as const, properties: { focused: view === "circuit" || index === selectedStop },
        geometry: { type: "Point" as const, coordinates: bay.coordinates },
      }))),
    });
    const addMarker = (element: HTMLElement, coordinates: Coordinate, offset: [number, number] = [0, 0]) => {
      markers.current.push(new maplibregl.Marker({ element, offset }).setLngLat(coordinates).addTo(map));
    };
    if (currentStop && view === "street") currentStop.bays.forEach((bay) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `parking-capacity-marker${bay.kind === "shared" ? " delivery" : ""}`;
      button.textContent = String(bay.capacity);
      button.setAttribute("aria-label", `${bay.capacity} mapped spaces on ${bay.street}, ${bay.kind === "shared" ? "shared delivery" : bay.kind} parking. Show parking section.`);
      button.onclick = (event) => {
        event.stopPropagation();
        popupRef.current?.remove();
        popupRef.current = new maplibregl.Popup({ offset: 18, maxWidth: "250px", className: "parking-section-popup" })
          .setLngLat(bay.coordinates).setDOMContent(bayDetails(bay)).addTo(map);
      };
      addMarker(button, bay.coordinates);
    });
    routeStops.forEach((stop, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `circuit-stop-marker${view === "street" && index === selectedStop ? " selected" : ""}${view === "circuit" ? " in-circuit" : ""}`;
      const number = document.createElement("span");
      number.textContent = String(index + 1);
      const label = document.createElement("span");
      label.className = "circuit-stop-label";
      label.textContent = stop.street;
      button.append(number, label);
      button.setAttribute("aria-label", `Street ${index + 1}${index === 0 ? ", circuit start" : ""}: ${stop.street}, ${stop.capacity} mapped spaces. Zoom to street.`);
      button.setAttribute("aria-pressed", String(view === "street" && index === selectedStop));
      button.onclick = () => onSelectStop(index);
      addMarker(button, stop.coordinates, [0, -29]);
    });
    if (view === "circuit" && plan && !searching) plan.candidates.forEach((alternative, index) => {
      if (index === selected) return;
      const anchor = stopsFor(alternative).find((stop) => !routeStops.some((current) => current.id === stop.id));
      if (!anchor) return;
      const label = alternative.circuit ? CIRCUIT_LABELS[alternative.circuit.strategy] : `Circuit ${index + 1}`;
      const alternativeSummary = circuitSummary(alternative);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "alternative-zone-marker";
      button.textContent = label;
      button.setAttribute("aria-label", `Select ${label} circuit: ${alternativeSummary.capacity} mapped spaces, ${alternativeSummary.streetCount} streets`);
      button.onclick = () => onSelect(index);
      addMarker(button, anchor.coordinates, [0, -12]);
    });
    if (destination) {
      const marker = document.createElement("div");
      marker.className = `destination-marker${searching && searchPhase === "streets" ? " destination-search-marker" : ""}`;
      const point = document.createElement("span");
      point.className = "destination-point";
      marker.append(point);
      if (!searching && !chosen) {
        const label = document.createElement("span");
        label.className = "destination-label";
        label.textContent = destination.label.split(" · ")[0];
        marker.append(label);
      }
      marker.setAttribute("role", "img");
      marker.setAttribute("aria-label", `Destination: ${destination.label}`);
      addMarker(marker, destination.coordinates);
    }
    if (origin && searching && searchPhase === "journey") {
      const marker = document.createElement("div");
      marker.className = "search-origin-marker";
      marker.setAttribute("role", "img");
      marker.setAttribute("aria-label", "Journey starts here");
      addMarker(marker, origin.coordinates);
    }
  }, [ready, plan, selected, selectedStop, onSelect, onSelectStop, destination, origin, searching, searchPhase, view]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (searching && origin && destination) {
      if (searchPhase === "streets") {
        // Center the destination in the unobscured map. Route arrivals never restart this camera move.
        const mobile = map.getContainer().clientHeight < 440;
        map.easeTo({
          center: destination.coordinates,
          padding: 0,
          offset: mobile ? [0, -16] : [0, 0],
          zoom: mobile ? 14.25 : 14.8,
          duration: reduceMotion() ? 0 : 1600,
          essential: false,
        });
      } else fitCoordinates(map, [origin.coordinates, destination.coordinates]);
    } else if (candidate) {
      if (camera.current.plan !== plan || camera.current.selected !== selected) showCircuit();
      else if (camera.current.focusRequest !== focusRequest || camera.current.selectedStop !== selectedStop) {
        if (focusMode === "circuit") showCircuit();
        else showStreet();
      }
    } else if (destination) {
      map.easeTo({ center: destination.coordinates, padding: 0, offset: [0, 0], duration: reduceMotion() ? 0 : 800, zoom: 14 });
    }
    camera.current = { plan, focusRequest, selected, selectedStop };
  }, [ready, plan, candidate, selected, selectedStop, focusRequest, focusMode, destination, origin, searching, searchPhase, showCircuit, showStreet]);

  return <>
    <div className="map-surface" ref={container} />
    {ready && candidate && focused && !error ? <div className="map-experience-controls" aria-label="Parking map views">
      <div className="map-view-switch">
        <button type="button" className={view === "circuit" ? "active" : ""} onClick={showCircuit} aria-pressed={view === "circuit"}><Route size={15} /> Circuit</button>
        <button type="button" className={view === "street" ? "active" : ""} onClick={showStreet} aria-pressed={view === "street"}><Focus size={15} /> Street</button>
      </div>
    </div> : null}
    {ready && destination && !candidate && !searching && <button type="button" className="map-recenter" aria-label="Recenter on destination"
      title="Recenter on destination" onClick={() => mapRef.current?.easeTo({ center: destination.coordinates, padding: 0, zoom: 14, duration: reduceMotion() ? 0 : 600 })}>
      <LocateFixed size={17} />
    </button>}
    {ready && candidate && <div className="map-legend" aria-label="Map legend">{stops.length > 1 && <span>Circuit</span>}<span>Walk</span></div>}
    {error && <div className="map-error" role="status"><strong>Map unavailable</strong><span>You can still compare circuits and open directions.</span><button type="button" onClick={() => setAttempt(n => n + 1)}>Retry map</button></div>}
  </>;
}
