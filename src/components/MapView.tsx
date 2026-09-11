import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Plan, Place, SearchTrace } from "../types";
import { useSearchRays } from "./useSearchRays";
maplibregl.setWorkerUrl(mapWorkerUrl);
export function MapView({
  plan,
  selected,
  onSelect,
  destination,
  origin,
  searching,
  traces,
}: {
  plan: Plan | null;
  selected: number;
  onSelect: (i: number) => void;
  destination: Place | null;
  origin: Place | null;
  searching: boolean;
  traces: SearchTrace[];
}) {
  const container = useRef<HTMLDivElement>(null),
    mapRef = useRef<maplibregl.Map | null>(null),
    markers = useRef<maplibregl.Marker[]>([]),
    [ready, setReady] = useState(false),
    [error, setError] = useState(false);
  useSearchRays(mapRef, ready, searching, traces);
  useEffect(() => {
    if (!container.current) return;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: container.current,
        style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
        center: [2.349, 48.869],
        zoom: 13.25,
        attributionControl: { compact: true },
      });
    } catch {
      setError(true);
      return;
    }
    mapRef.current = map;
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "bottom-right",
    );
    map.on("load", () => {
      map.addSource("routes", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "drive-shadow",
        type: "line",
        source: "routes",
        filter: ["==", ["get", "kind"], "drive"],
        paint: {
          "line-color": "#fffefb",
          "line-width": 9,
          "line-opacity": 0.95,
        },
        layout: { "line-cap": "round", "line-join": "round" },
      });
      map.addLayer({
        id: "drive",
        type: "line",
        source: "routes",
        filter: ["==", ["get", "kind"], "drive"],
        paint: {
          "line-color": "#3a6655",
          "line-width": 5,
          "line-opacity": 0.9,
        },
        layout: { "line-cap": "round", "line-join": "round" },
      });
      map.addLayer({
        id: "walk",
        type: "line",
        source: "routes",
        filter: ["==", ["get", "kind"], "walk"],
        paint: {
          "line-color": "#76923d",
          "line-width": 4,
          "line-dasharray": [1, 1.6],
        },
        layout: { "line-cap": "round" },
      });
      map.addSource("parking", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "parking-spots",
        type: "circle",
        source: "parking",
        paint: {
          "circle-radius": 5,
          "circle-color": "#668648",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#fffefb",
          "circle-opacity": 0.8,
        },
      });
      setReady(true);
    });
    return () => {
      markers.current.forEach((m) => m.remove());
      map.remove();
      mapRef.current = null;
    };
  }, []);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    markers.current.forEach((m) => m.remove());
    markers.current = [];
    const source = map.getSource("routes") as maplibregl.GeoJSONSource,
      parking = map.getSource("parking") as maplibregl.GeoJSONSource;
    const candidate = searching ? undefined : plan?.candidates[selected];
    source.setData({
      type: "FeatureCollection",
      features: candidate
        ? [
            {
              type: "Feature",
              properties: { kind: "drive" },
              geometry: candidate.drive.geometry,
            },
            {
              type: "Feature",
              properties: { kind: "walk" },
              geometry: candidate.walk.geometry,
            },
          ]
        : [],
    });
    parking.setData({
      type: "FeatureCollection",
      features: candidate
        ? candidate.bays.map((b) => ({
            type: "Feature",
            properties: {},
            geometry: { type: "Point", coordinates: b.coordinates },
          }))
        : [],
    });
    if (plan && !searching)
      plan.candidates.forEach((c, index) => {
        const button = document.createElement("button");
        button.className = `zone-marker ${index === selected ? "selected" : ""}`;
        button.textContent = `${String(index + 1).padStart(2, "0")} · ${Math.round(c.total)} min`;
        button.setAttribute(
          "aria-label",
          `Select ${c.street}, ${Math.round(c.total)} minutes total`,
        );
        button.onclick = () => onSelect(index);
        markers.current.push(
          new maplibregl.Marker({
            element: button,
            anchor: "bottom",
            offset: [0, -8],
          })
            .setLngLat(c.coordinates)
            .addTo(map),
        );
      });
    if (destination) {
      const marker = document.createElement("div");
      marker.className = "destination-marker";
      marker.textContent = "↗";
      marker.setAttribute("aria-label", destination.label);
      markers.current.push(
        new maplibregl.Marker({ element: marker })
          .setLngLat(destination.coordinates)
          .addTo(map),
      );
    }
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (searching && origin && destination) {
      const startMarker = document.createElement("div");
      startMarker.className = "search-origin-marker";
      startMarker.setAttribute("aria-label", "Journey starts here");
      markers.current.push(new maplibregl.Marker({ element: startMarker }).setLngLat(origin.coordinates).addTo(map));
      const bounds = new maplibregl.LngLatBounds().extend(origin.coordinates).extend(destination.coordinates);
      map.fitBounds(bounds, { padding: innerWidth < 760 ? { top: 95, bottom: 220, left: 35, right: 35 } : { top: 125, bottom: 160, left: 490, right: 80 }, duration: reduced ? 0 : 900, maxZoom: 14.5 });
    } else if (candidate) {
      const bounds = new maplibregl.LngLatBounds();
      candidate.drive.geometry.coordinates.forEach((p) => bounds.extend(p));
      candidate.walk.geometry.coordinates.forEach((p) => bounds.extend(p));
      const mobile = innerWidth < 760;
      map.fitBounds(bounds, {
        padding: mobile
          ? { top: 95, bottom: 260, left: 35, right: 35 }
          : { top: 130, bottom: 130, left: 485, right: 90 },
        duration: reduced ? 0 : 1000,
        maxZoom: 15,
      });
    } else if (destination)
      map.easeTo({
        center: destination.coordinates,
        offset: innerWidth < 760 ? [0, -50] : [215, 0],
        duration: reduced ? 0 : 800,
        zoom: 14,
      });
  }, [ready, plan, selected, onSelect, destination, origin, searching]);
  return (
    <>
      <div className="map-surface" ref={container} />
      {error ? (
        <div className="map-error">
          Your browser could not display the map. Street recommendations and
          navigation links still work.
        </div>
      ) : null}
    </>
  );
}
