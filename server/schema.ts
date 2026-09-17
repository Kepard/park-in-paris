import { z } from "zod";
import { parseParis } from "../src/lib/rules.js";
const coordinate = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const isoDate = z.string().max(40).refine(v => Number.isFinite(Date.parse(v)));
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).refine(v => { try { parseParis(v); return true; } catch { return false; } });
const place = z.object({ label: z.string().min(1).max(300), coordinates: coordinate, postcode: z.string().max(20).optional() });
const minutes = z.number().finite().min(0).max(10000);
const route = z.object({ duration: z.number().finite().min(0).max(86400), distance: z.number().finite().min(0).max(10000000), geometry: z.object({ type: z.literal("LineString"), coordinates: z.array(coordinate).min(1).max(20000) }) });
const bay = z.object({ id: z.string().max(150), street: z.string().max(200), arrondissement: z.number().int().min(1).max(20), coordinates: coordinate, capacity: z.number().positive().max(1000), kind: z.enum(["paid", "free", "shared"]), customHours: z.boolean() });
const searchStop = z.object({
  id: z.string().max(150), street: z.string().max(200), arrondissement: z.number().int().min(1).max(20),
  coordinates: coordinate, bays: z.array(bay).max(1000), capacity: z.number().min(0).max(10000),
  sharedCapacity: z.number().min(0).max(10000), walk: route, walkMinutes: minutes,
  parkingType: z.enum(["paid", "free", "mixed"]), driveFromPrevious: route.optional(),
  arrivalLow: isoDate, arrivalHigh: isoDate, totalLow: minutes, totalHigh: minutes,
});
const searchRoute = z.object({
  stops: z.array(searchStop).min(1).max(4), capacity: z.number().min(0).max(40000),
  extraDriveMinutes: minutes, totalLow: minutes, totalHigh: minutes,
});
export const tripSchema = z.object({
  id: z.uuid(), createdAt: isoDate, status: z.enum(["active", "completed"]), modelVersion: z.string().min(1).max(60), completedAt: isoDate.optional(),
  input: z.object({ origin: place, destination: place, departure: localDate, returnAt: localDate, maxWalk: z.number().min(5).max(30), rushAllowance: z.boolean(), useExperience: z.boolean() }),
  candidate: z.object({ id: z.string().max(150), street: z.string().max(200), arrondissement: z.number().int().min(1).max(20), coordinates: coordinate, bays: z.array(bay).max(1000), capacity: z.number().min(0).max(10000), sharedCapacity: z.number().min(0).max(10000), drive: route, walk: route, driveMinutes: minutes, walkMinutes: minutes, searchLow: minutes, searchHigh: minutes, totalLow: minutes, totalHigh: minutes, total: minutes, arrival: isoDate, learnedFrom: z.number().int().min(0), reason: z.string().max(500), parkingType: z.enum(["paid", "free", "mixed"]), searchRoute: searchRoute.optional() }),
  survey: z.object({ outcome: z.enum(["here", "elsewhere", "gave-up"]), searchMinutes: z.number().min(0).max(180), streetsTried: z.number().int().min(1).max(50), bayType: z.enum(["ordinary", "delivery", "other"]), note: z.string().max(500), submittedAt: isoDate, actualStreet: z.string().max(300), observedArrival: isoDate, parkedStopId: z.string().max(150).optional() }).optional(),
}).refine(t => t.status !== "completed" || !!t.survey, "Completed trips need feedback");
