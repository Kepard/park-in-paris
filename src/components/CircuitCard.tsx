import { Check, Footprints, Route } from "lucide-react";
import type { Candidate } from "../types";
import { CIRCUIT_LABELS, circuitSummary } from "../lib/circuitSummary";
import "./CircuitCard.css";

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
  const distance = summary.driveMetres < 1000
    ? `${Math.round(summary.driveMetres / 10) * 10} m`
    : `${(summary.driveMetres / 1000).toFixed(1)} km`;
  return <button type="button" className={`circuit-card${selected ? " is-selected" : ""}`}
    aria-pressed={selected} onClick={onSelect}>
    <span className="circuit-card-heading">
      <strong>{strategy ? CIRCUIT_LABELS[strategy] : "Parking circuit"}</strong>
      <span className="circuit-selection" aria-hidden="true">{selected && <Check size={12} strokeWidth={3} />}</span>
    </span>
    <span className="circuit-card-metrics"><strong>{summary.capacity}</strong> mapped spaces</span>
    <span className="circuit-card-meta">
      <span><Footprints size={14} />{walkingRange(summary.walkMin, summary.walkMax)} min walk</span>
      <span><Route size={14} />{summary.streetCount === 1 ? "1 street" : `${summary.streetCount} streets · ${distance}`}</span>
    </span>
  </button>;
}
