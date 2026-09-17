import type { Candidate, CircuitStrategy } from "../types";
import { circuitSummary } from "./circuitSummary";

/** Opportunity scores are comparative heuristics, never measured vacancy probabilities. */
export function circuitUtility(candidate: Candidate, strategy: CircuitStrategy = "balanced") {
  const summary = circuitSummary(candidate);
  const weights = strategy === "closest"
    ? { spaces: 5, walk: 1.1, worst: 0.6, drive: 0.5, metres: 0.0004, approach: 0.08 }
    : strategy === "more-spaces"
      ? { spaces: 14, walk: 0.2, worst: 0.1, drive: 0.65, metres: 0.0006, approach: 0.08 }
      : { spaces: 10, walk: 0.7, worst: 0.25, drive: 0.65, metres: 0.0007, approach: 0.12 };
  return weights.spaces * Math.log1p(summary.capacity) - weights.walk * summary.walkWeighted -
    weights.worst * summary.walkMax - weights.drive * summary.driveMinutes - weights.metres * summary.driveMetres -
    weights.approach * candidate.driveMinutes;
}

/** Same street set in another order is one choice; heavily overlapping alternatives are not useful cards. */
export function similarCircuits(a: Candidate, b: Candidate) {
  const streets = (candidate: Candidate) => new Set((candidate.searchRoute?.stops ?? [candidate]).map(stop => stop.street));
  const left = streets(a), right = streets(b);
  const common = [...left].filter(street => right.has(street)).length;
  return common / (left.size + right.size - common) >= 0.6;
}

function dominates(a: Candidate, b: Candidate) {
  const left = circuitSummary(a), right = circuitSummary(b);
  const comparisons = [
    left.capacity >= right.capacity,
    left.walkWeighted <= right.walkWeighted + 0.1,
    left.walkMax <= right.walkMax + 0.1,
    left.driveMinutes <= right.driveMinutes + 0.1,
    left.driveMetres <= right.driveMetres + 20,
    a.driveMinutes <= b.driveMinutes + 0.5,
  ];
  return comparisons.every(Boolean) && (left.capacity > right.capacity || left.walkWeighted < right.walkWeighted - 0.1 ||
    left.walkMax < right.walkMax - 0.1 || left.driveMinutes < right.driveMinutes - 0.1 ||
    left.driveMetres < right.driveMetres - 20 || a.driveMinutes < b.driveMinutes - 0.5);
}

/** Pick a genuine compromise and only add alternatives that improve the metric their label promises. */
export function selectCircuitChoices(candidates: Candidate[]): Candidate[] {
  if (!candidates.length) return [];
  // A single street remains a fallback when the routed graph cannot form any viable circuit.
  const circuits = candidates.some(candidate => (candidate.searchRoute?.stops.length ?? 1) >= 2)
    ? candidates.filter(candidate => (candidate.searchRoute?.stops.length ?? 1) >= 2) : candidates;
  const frontier = circuits.filter(candidate => !circuits.some(other => other !== candidate && dominates(other, candidate)));
  const pool = frontier.length ? frontier : circuits;
  const best = [...pool].sort((a, b) => circuitUtility(b) - circuitUtility(a))[0];
  const balanced = { ...best, circuit: { strategy: "balanced" as const } };
  const summary = circuitSummary(balanced);
  const results: Candidate[] = [balanced];
  const distinct = (candidate: Candidate) => !results.some(other => similarCircuits(candidate, other));
  const closest = [...pool].filter(candidate => distinct(candidate) &&
    circuitSummary(candidate).walkWeighted <= summary.walkWeighted - 1 &&
    circuitSummary(candidate).walkMax <= summary.walkMax - 0.5)
    .sort((a, b) => circuitSummary(a).walkWeighted - circuitSummary(b).walkWeighted ||
      circuitUtility(b, "closest") - circuitUtility(a, "closest"))[0];
  if (closest) results.push({ ...closest, circuit: { strategy: "closest" } });
  const moreSpaces = [...pool].filter(candidate => distinct(candidate) &&
    circuitSummary(candidate).capacity >= Math.max(...results.map(other => circuitSummary(other).capacity)) + Math.max(10, Math.ceil(summary.capacity * 0.15)))
    .sort((a, b) => circuitUtility(b, "more-spaces") - circuitUtility(a, "more-spaces"))[0];
  if (moreSpaces) results.push({ ...moreSpaces, circuit: { strategy: "more-spaces" } });
  return results;
}
