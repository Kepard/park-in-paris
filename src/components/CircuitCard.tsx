import { useMemo } from "react";
import * as m from "motion/react-m";
import { Footprints, Route } from "lucide-react";
import type { Candidate, CircuitStrategy, Coordinate } from "../types";
import { CIRCUIT_LABELS, circuitSummary } from "../lib/circuitSummary";
import "./CircuitCard.css";

const shortLabels: Record<CircuitStrategy, string> = {
  balanced: "Balanced", closest: "Closest", "more-spaces": "More spaces",
};

function walkingRange(min: number, max: number) {
  const low = Math.ceil(min), high = Math.ceil(max);
  return low === high ? String(low) : `${low}–${high}`;
}

// A miniature of the routed circuit and its first walking leg, all in one local projection.
function RouteSketch({ candidate }: { candidate: Candidate }) {
  const sketch = useMemo(() => {
    const stops = candidate.searchRoute?.stops ?? [];
    const legs = stops.flatMap(stop => stop.driveFromPrevious ? [stop.driveFromPrevious.geometry.coordinates] : []);
    const walk = candidate.walk.geometry.coordinates;
    const paths = [...legs, walk].filter(line => line.length > 1);
    if (!paths.length) return null;
    const lonScale = Math.cos(candidate.coordinates[1] * Math.PI / 180);
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    for (const line of paths) {
      for (const [lon, lat] of line) {
        const x = lon * lonScale;
        left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, -lat); bottom = Math.max(bottom, -lat);
      }
    }
    const width = right - left, height = bottom - top;
    const scale = Math.min(114 / (width || 1e-8), 74 / (height || 1e-8));
    const project = ([lon, lat]: Coordinate) => [
      (128 - width * scale) / 2 + (lon * lonScale - left) * scale,
      (90 - height * scale) / 2 + (-lat - top) * scale,
    ];
    const linePath = (line: Coordinate[]) => line.map((p, i) => {
      const [x, y] = project(p);
      return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(" ");
    return {
      drive: legs.map(linePath).join(" "), walk: linePath(walk),
      start: project(candidate.coordinates), end: project(walk.at(-1) ?? candidate.coordinates),
    };
  }, [candidate]);
  if (!sketch) return null;
  return <svg className="route-sketch" viewBox="0 0 128 90" aria-hidden="true" focusable="false">
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d={sketch.walk} stroke="#e0ebd8" strokeWidth="2.6" strokeDasharray="1 5" />
      {sketch.drive && <m.path d={sketch.drive} stroke="#d2fa85" strokeWidth="3.8"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.55, ease: "easeOut" }} />}
    </g>
    <circle cx={sketch.start[0]} cy={sketch.start[1]} r="4" fill="#d2fa85" stroke="#193c30" strokeWidth="1.5" />
    <circle cx={sketch.end[0]} cy={sketch.end[1]} r="4.5" fill="#193c30" stroke="#fff" strokeWidth="2" />
  </svg>;
}

export function CircuitChoices({ candidates, selected, onSelect }: {
  candidates: Candidate[];
  selected: number;
  onSelect: (index: number) => void;
}) {
  const summaries = useMemo(() => candidates.map(circuitSummary), [candidates]);
  const candidate = candidates[selected], summary = summaries[selected];
  const strategy = candidate.circuit?.strategy;
  const name = strategy ? CIRCUIT_LABELS[strategy] : "Parking circuit";
  const distance = summary.driveMetres < 1000
    ? `${Math.round(summary.driveMetres / 10) * 10} m`
    : `${(summary.driveMetres / 1000).toFixed(1)} km`;
  return <div className="circuit-choices">
    {candidates.length > 1 && <fieldset className="circuit-picker">
      <legend className="sr-only">Choose a parking circuit</legend>
      {candidates.map((choice, index) => {
        const kind = choice.circuit?.strategy;
        return <label key={kind ?? choice.id} className={index === selected ? "chosen" : ""}>
          <input className="sr-only" type="radio" name="circuit" checked={index === selected}
            aria-label={`${kind ? CIRCUIT_LABELS[kind] : "Circuit " + (index + 1)}, ${summaries[index].capacity} mapped spaces`}
            onChange={() => onSelect(index)} />
          {index === selected && <m.span className="choice-highlight" layoutId="active-circuit" />}
          <span>{kind ? shortLabels[kind] : `Circuit ${index + 1}`}</span>
          <small>{summaries[index].capacity} spaces</small>
        </label>;
      })}
    </fieldset>}
    <div className="circuit-card" role="group" aria-label={name}>
      <m.div key={candidate.id + name} className="ticket-body" initial={{ opacity: 0.4, y: 4 }} animate={{ opacity: 1, y: 0 }}
        drag={candidates.length > 1 ? "x" : false} dragMomentum={false} dragConstraints={{ left: 0, right: 0 }}
        dragElastic={{ left: selected < candidates.length - 1 ? 0.32 : 0.08, right: selected > 0 ? 0.32 : 0.08 }}
        onDragEnd={(_, { offset }) => {
          if (Math.abs(offset.x) < 40 || Math.abs(offset.x) <= Math.abs(offset.y) * 1.5) return;
          const next = selected + (offset.x < 0 ? 1 : -1);
          if (next >= 0 && next < candidates.length) onSelect(next);
        }}>
        <div className="ticket-title">{name}</div>
        <div className="ticket-metric"><strong>{summary.capacity}</strong> <span>mapped spaces</span></div>
        <RouteSketch candidate={candidate} />
        <div className="ticket-meta">
          <span><Footprints size={15} />{walkingRange(summary.walkMin, summary.walkMax)} min walk</span>
          <span><Route size={15} />{summary.streetCount === 1 ? "1 street" : `${summary.streetCount} streets · ${distance}`}</span>
        </div>
      </m.div>
    </div>
  </div>;
}
