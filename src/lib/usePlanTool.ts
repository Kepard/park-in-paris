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
        description: "Read the parking search routes currently shown, including ordered streets, mapped space counts and provisional door-to-door time ranges. Does not start or save a trip.",
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
              searchRoute: c.searchRoute ? {
                mappedCapacity: c.searchRoute.capacity,
                extraDriveMinutes: c.searchRoute.extraDriveMinutes,
                totalRangeMinutes: [c.searchRoute.totalLow, c.searchRoute.totalHigh],
                stops: c.searchRoute.stops.map((stop, index) => ({
                  order: index + 1,
                  id: stop.id,
                  street: stop.street,
                  coordinates: stop.coordinates,
                  mappedCapacity: stop.capacity,
                  walkMinutes: stop.walkMinutes,
                  driveFromPreviousMinutes: stop.driveFromPrevious
                    ? (stop.driveFromPrevious.duration / 60) * (c.drive.duration > 0
                      ? c.driveMinutes / (c.drive.duration / 60)
                      : 1)
                    : null,
                  arrivalRange: [stop.arrivalLow, stop.arrivalHigh],
                  totalRangeMinutes: [stop.totalLow, stop.totalHigh],
                })),
              } : null,
            })),
          };
        },
      }, { signal: lifecycle.signal })).catch(() => undefined);
    } catch { /* Optional browser capability; the regular UI remains available. */ }
    return () => lifecycle.abort();
  }, []);
}
