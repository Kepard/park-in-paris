import { useEffect, useRef } from "react";
import type { Plan } from "../types";

type ToolContext = {
  registerTool: (tool: {
    name: string;
    description: string;
    inputSchema: object;
    annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
    execute: (input: unknown) => unknown;
  }, options: { signal: AbortSignal }) => void | Promise<void>;
};

export function usePlanTool(plan: Plan | null) {
  const latest = useRef(plan);
  latest.current = plan;
  useEffect(() => {
    const context = (document as Document & { modelContext?: ToolContext }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    try {
      void Promise.resolve(context.registerTool({
        name: "read_parking_recommendations",
        description: "Read the parking alternatives currently shown after a search, including provisional time ranges. Does not start or save a trip.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute(input) {
          if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length) throw new Error("Expected an empty object.");
          const current = latest.current;
          if (!current) return { status: "no_search_yet" };
          return {
            status: "ready", modelVersion: current.modelVersion,
            caveat: "Uncalibrated search estimates; no live occupancy or traffic feed.",
            alternatives: current.candidates.map(c => ({
              street: c.street, coordinates: c.coordinates,
              driveMinutes: c.driveMinutes, walkMinutes: c.walkMinutes,
              searchRangeMinutes: [c.searchLow, c.searchHigh],
              totalRangeMinutes: [c.totalLow, c.totalHigh], mappedCapacity: c.capacity,
            })),
          };
        },
      }, { signal: lifecycle.signal })).catch(() => undefined);
    } catch { /* Optional browser capability; the regular UI remains available. */ }
    return () => lifecycle.abort();
  }, []);
}
