import type { Candidate, Coordinate } from "../types";
import { navigationURL } from "./api";

type ParkingStop = Pick<Candidate, "street" | "coordinates" | "capacity">;
type ParkingNavigationPlan = ParkingStop & { searchRoute?: { stops: ParkingStop[] } };

export function parkingStops(candidate: ParkingNavigationPlan): ParkingStop[] {
  return candidate.searchRoute?.stops.length ? candidate.searchRoute.stops : [candidate];
}

export function googleParkingRouteURL(candidate: ParkingNavigationPlan, origin: Coordinate) {
  const stops = parkingStops(candidate);
  const url = new URL(navigationURL("google", stops[stops.length - 1].coordinates, origin));
  // Four parking stops use three waypoints, supported by Google Maps mobile browsers.
  if (stops.length > 1) url.searchParams.set("waypoints", stops.slice(0, -1)
    .map(stop => `${stop.coordinates[1]},${stop.coordinates[0]}`).join("|"));
  return url.toString();
}
