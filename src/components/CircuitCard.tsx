import { Check, Footprints, Route, Sparkles } from "lucide-react";
import type { Candidate } from "../types";
import { CIRCUIT_LABELS, circuitSummary } from "../lib/circuitSummary";
import "./CircuitCard.css";

const descriptions = {
  balanced: "A balance of nearby spaces and a compact drive.",
  closest: "Prioritises a shorter walk to your destination.",
  "more-spaces": "Prioritises mapped spaces within your walking limit.",
};

export function walkingRange(min: number, max: number) {
  const low = Math.ceil(min), high = Math.ceil(max);
  return low === high ? String(low) : `${low}–${high}`;
}

export function CircuitCard({ candidate, selected, onSelect }: {
  candidate: Candidate;
  selected: boolean;
  onSelect: () => void;
}) {
  const summary = circuitSummary(candidate);
  const strategy = candidate.circuit?.strategy;
  const golden = strategy === "balanced";
  const label = strategy ? CIRCUIT_LABELS[strategy] : "Parking circuit";
  const stops = candidate.searchRoute?.stops.length ? candidate.searchRoute.stops : [candidate];
  const distance = summary.driveMetres < 1000
    ? `${Math.round(summary.driveMetres / 10) * 10} m`
    : `${(summary.driveMetres / 1000).toFixed(1)} km`;
  return (
    <button
      type="button"
      className={`circuit-card ${golden ? "is-golden" : ""} ${selected ? "is-selected" : ""}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="circuit-card-heading">
        <span className="circuit-card-name">{golden ? <Sparkles size={16} aria-hidden="true" /> : <Route size={16} aria-hidden="true" />}{label}</span>
        <span className="circuit-selection" aria-hidden="true">{selected ? <Check size={13} /> : null}</span>
      </span>
      <span className="circuit-card-description">{strategy ? descriptions[strategy] : "Explore these nearby streets in order."}</span>
      <span className="circuit-card-metrics">
        <span className="circuit-capacity"><strong>{summary.capacity}</strong><span>mapped spaces<small>across {summary.streetCount} {summary.streetCount === 1 ? "street" : "streets"}</small></span></span>
        <span className="circuit-walk"><strong>{walkingRange(summary.walkMin, summary.walkMax)}<small> min</small></strong><span><Footprints size={12} aria-hidden="true" /> walk</span></span>
      </span>
      <span className="circuit-length"><Route size={13} aria-hidden="true" />{summary.streetCount > 1 ? `${distance} · ${Math.ceil(summary.driveMinutes)} min between streets` : "One compact parking area"}{golden ? <span>RECOMMENDED</span> : null}</span>
      <span className="circuit-street-sequence">
        {stops.map((stop, index) => <span key={stop.id}>{index ? <span className="circuit-sequence-arrow" aria-hidden="true"> → </span> : null}{stop.street}</span>)}
      </span>
    </button>
  );
}
