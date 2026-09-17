import { useCallback, useEffect, useRef, useState } from "react";
import { Focus, Route } from "lucide-react";
import * as maplibregl from "maplibre-gl";
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Bay, Candidate, Coordinate, Plan, Place, SearchTrace } from "../types";
import { useSearchRays } from "./useSearchRays";
import "./map-experience.css";

maplibregl.setWorkerUrl(mapWorkerUrl);
const empty = () => ({ type: "FeatureCollection" as const, features: [] });
const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const stopsFor = (candidate: Candidate) => candidate.searchRoute?.stops ?? [candidate];

function padding(map: maplibregl.Map, detail = false) {
  const mobile = window.innerWidth < 760;
  return mobile
    ? { top: detail ? 182 : 130, bottom: Math.max(105, map.getContainer().clientHeight - 380), left: 38, right: 38 }
    : { top: detail ? 180 : 140, bottom: 135, left: 485, right: 90 };
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
  plan, selected, selectedStop, focusRequest, onSelect, onSelectStop,
  destination, origin, searching, searchPhase, traces,
}: {
  plan: Plan | null;
  selected: number;
  selectedStop: number;
  focusRequest: number;
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
  const [view, setView] = useState<"circuit" | "street">("circuit");
  const candidate = searching ? undefined : plan?.candidates[selected];
  const stops = candidate ? stopsFor(candidate) : [];
  const focused = stops[selectedStop] ?? stops[0];
  useSearchRays(mapRef, ready, searching, traces, searchPhase, destination?.coordinates);

  useEffect(() => {
    if (!container.current) return;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: container.current,
        style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
        center: [2.349, 48.869], zoom: 13.25,
        attributionControl: { compact: true },
      });
    } catch {
      setError(true);
      return;
    }
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    const updateDetail = () => map.getContainer().classList.toggle("show-parking-labels", map.getZoom() >= 15.6);
    map.on("zoom", updateDetail);
    map.on("load", () => {
      map.addSource("routes", { type: "geojson", data: empty() });
      map.addLayer({
        id: "drive-shadow", type: "line", source: "routes",
        filter: ["!=", ["get", "kind"], "walk"],
        paint: { "line-color": "#fffefb", "line-width": 10, "line-opacity": 0.95 },
        layout: { "line-cap": "round", "line-join": "round" },
      });
      map.addLayer({
        id: "drive", type: "line", source: "routes", filter: ["==", ["get", "kind"], "drive"],
        paint: { "line-color": "#729181", "line-width": 4, "line-opacity": 0.75 },
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
      markers.current.forEach((marker) => marker.remove());
      popupRef.current?.remove();
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

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
      { type: "Feature" as const, properties: { kind: "drive" }, geometry: chosen.drive.geometry },
      ...routeStops.flatMap((stop) => "driveFromPrevious" in stop && stop.driveFromPrevious
        ? [{ type: "Feature" as const, properties: { kind: "circuit" }, geometry: stop.driveFromPrevious.geometry }] : []),
      { type: "Feature" as const, properties: { kind: "walk" }, geometry: currentStop.walk.geometry },
    ] : [];
    (map.getSource("routes") as maplibregl.GeoJSONSource).setData({ type: "FeatureCollection", features: lines });
    (map.getSource("parking") as maplibregl.GeoJSONSource).setData({
      type: "FeatureCollection",
      features: routeStops.flatMap((stop, index) => stop.bays.map((bay) => ({
        type: "Feature" as const, properties: { focused: index === selectedStop },
        geometry: { type: "Point" as const, coordinates: bay.coordinates },
      }))),
    });
    const addMarker = (element: HTMLElement, coordinates: Coordinate, offset: [number, number] = [0, 0]) => {
      markers.current.push(new maplibregl.Marker({ element, offset }).setLngLat(coordinates).addTo(map));
    };
    if (currentStop) currentStop.bays.forEach((bay) => {
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
      button.className = `circuit-stop-marker${index === selectedStop ? " selected" : ""}`;
      const number = document.createElement("span");
      number.textContent = String(index + 1);
      const label = document.createElement("span");
      label.className = "circuit-stop-label";
      label.textContent = stop.street;
      button.append(number, label);
      button.setAttribute("aria-label", `${index === 0 ? "Start" : `Backup ${index}`}: ${stop.street}, ${stop.capacity} mapped spaces. Zoom to street.`);
      button.setAttribute("aria-pressed", String(index === selectedStop));
      button.onclick = () => onSelectStop(index);
      addMarker(button, stop.coordinates, [0, -29]);
    });
    if (view === "circuit" && plan && !searching) plan.candidates.forEach((alternative, index) => {
      if (index === selected || routeStops.some((stop) => stop.id === alternative.id)) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "alternative-zone-marker";
      button.textContent = `Option ${index + 1}`;
      button.setAttribute("aria-label", `Select option ${index + 1}: ${alternative.street}, ${alternative.capacity} mapped spaces`);
      button.onclick = () => onSelect(index);
      addMarker(button, alternative.coordinates, [0, -12]);
    });
    if (destination) {
      const marker = document.createElement("div");
      marker.className = `destination-marker${searching && searchPhase === "streets" ? " destination-search-marker" : ""}`;
      marker.textContent = "↗";
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
        const mobile = window.innerWidth < 760;
        map.easeTo({
          center: destination.coordinates,
          padding: 0,
          offset: mobile ? [0, -55] : [215, -25],
          zoom: mobile ? 14.25 : 14.8,
          duration: reduceMotion() ? 0 : 1600,
          essential: false,
        });
      } else fitCoordinates(map, [origin.coordinates, destination.coordinates]);
    } else if (candidate) {
      if (camera.current.plan !== plan) showCircuit();
      else if (camera.current.focusRequest !== focusRequest || camera.current.selected !== selected || camera.current.selectedStop !== selectedStop) showStreet();
    } else if (destination) {
      map.easeTo({ center: destination.coordinates, offset: innerWidth < 760 ? [0, -80] : [215, 0], duration: reduceMotion() ? 0 : 800, zoom: 14 });
    }
    camera.current = { plan, focusRequest, selected, selectedStop };
  }, [ready, plan, candidate, selected, selectedStop, focusRequest, destination, origin, searching, searchPhase, showCircuit, showStreet]);

  return <>
    <div className="map-surface" ref={container} />
    {ready && candidate && focused && !error ? <div className="map-experience-controls" aria-label="Parking map views">
      <div className="map-view-switch">
        <button type="button" className={view === "circuit" ? "active" : ""} onClick={showCircuit} aria-pressed={view === "circuit"}><Route size={15} /> Circuit</button>
        <button type="button" className={view === "street" ? "active" : ""} onClick={showStreet} aria-pressed={view === "street"}><Focus size={15} /> Street</button>
      </div>
      {stops.length > 1 ? <div className="map-stop-switch" aria-label="Streets in this parking plan">
        {stops.map((stop, index) => <button
          type="button"
          key={stop.id}
          className={selectedStop === index ? "active" : ""}
          aria-pressed={selectedStop === index}
          aria-label={`${index === 0 ? "Start" : `Backup ${index}`}: ${stop.street}. Zoom to street.`}
          title={`${stop.street} · ${stop.capacity} mapped spaces`}
          onClick={() => onSelectStop(index)}
        ><span>{index + 1}</span>{index === 0 ? "Start" : `Backup ${index}`}</button>)}
      </div> : null}
      {view === "street" ? <div className="map-street-key">
        <span className="map-key-dot" />
        <span><strong>{focused.capacity} mapped spaces</strong><small>Tap a section for details · availability unknown</small></span>
      </div> : null}
    </div> : null}
    {error ? <div className="map-error">Your browser could not display the map. Street recommendations and navigation links still work.</div> : null}
  </>;
}
