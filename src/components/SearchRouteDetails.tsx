import { ArrowUpRight, Car, CircleParking, Footprints, MapPin, Route } from "lucide-react";
import type { Candidate, Place } from "../types";
import { navigationURL } from "../lib/api";
import "./SearchRouteDetails.css";

const minuteRange = (low: number, high: number) =>
  `${Math.floor(low)}–${Math.ceil(high)}`;

export function SearchRouteDetails({
  candidate,
  selectedStop = 0,
  onSelectStop,
  destination,
  origin,
  compact = false,
}: {
  candidate: Candidate;
  selectedStop?: number;
  onSelectStop?: (index: number) => void;
  destination: Place;
  origin?: Place;
  compact?: boolean;
}) {
  const route = candidate.searchRoute;
  if (!route?.stops.length) return null;
  const hasAlternatives = route.stops.length > 1;
  const first = route.stops[0];
  const drivingAllowance = candidate.drive.duration > 0
    ? candidate.driveMinutes / (candidate.drive.duration / 60)
    : 1;

  return (
    <section
      className={`search-route-details${compact ? " search-route-compact" : ""}`}
      aria-label="Your parking search route"
    >
      <div className="search-route-heading">
        <span><Route size={16} aria-hidden="true" /> {hasAlternatives ? "A plan for the next street, too." : "Start your search here."}</span>
        <small>{route.stops.length} {hasAlternatives ? "streets" : "street"}</small>
      </div>
      <div className="search-route-summary">
        <div>
          <strong>{minuteRange(route.totalLow, route.totalHigh)} <small>min</small></strong>
          <span>drive + search + walk</span>
        </div>
        <p><CircleParking size={15} aria-hidden="true" /> <b>{route.capacity}</b> mapped spaces{hasAlternatives ? " along the route" : " on this street"}</p>
      </div>
      {!compact ? (
        <p className="search-route-explainer">
          {hasAlternatives
            ? "Try these streets in order. If the first is full, carry on to the next. Select a street to explore its mapped parking."
            : "Select the street to explore its mapped parking."}
        </p>
      ) : null}
      <ol className="search-route-stops">
        {route.stops.map((stop, index) => {
          const isSelected = selectedStop === index;
          const incomingMinutes = stop.driveFromPrevious
            ? Math.max(1, Math.ceil((stop.driveFromPrevious.duration / 60) * drivingAllowance))
            : Math.ceil(candidate.driveMinutes);
          const content = (
            <>
              <span className="search-stop-number" aria-hidden="true">{index + 1}</span>
              <span className="search-stop-copy">
                <span className="search-stop-position">{index === 0 ? "Start here" : `Then try street ${index + 1}`}</span>
                <strong>{stop.street}</strong>
                <span className="search-stop-facts">
                  <span><CircleParking size={12} aria-hidden="true" /> {stop.capacity} spaces</span>
                  <span><Footprints size={12} aria-hidden="true" /> {Math.ceil(stop.walkMinutes)} min walk</span>
                </span>
                <span className="search-stop-drive"><Car size={12} aria-hidden="true" /> {incomingMinutes} min {index === 0 ? "from your start" : "from the previous street"}</span>
              </span>
              {onSelectStop ? <MapPin className="search-stop-preview" size={16} aria-hidden="true" /> : null}
            </>
          );
          return (
            <li key={stop.id} className={onSelectStop && isSelected ? "search-stop-selected" : undefined}>
              {onSelectStop ? (
                <button
                  type="button"
                  className="search-stop-main"
                  aria-pressed={isSelected}
                  aria-label={`Preview street ${index + 1}: ${stop.street}, ${stop.capacity} mapped spaces`}
                  onClick={() => onSelectStop(index)}
                >
                  {content}
                </button>
              ) : <div className="search-stop-main">{content}</div>}
              {compact ? (
                <div className="search-stop-links">
                  <a href={navigationURL("waze", stop.coordinates)} target="_blank" rel="noopener noreferrer" aria-label={`Drive to ${stop.street} with Waze`}>Waze <ArrowUpRight size={12} aria-hidden="true" /></a>
                  <a href={navigationURL("google", stop.coordinates, index === 0 ? origin?.coordinates : route.stops[index - 1].coordinates)} target="_blank" rel="noopener noreferrer" aria-label={`Drive to ${stop.street} with Google Maps`}>Google Maps <ArrowUpRight size={12} aria-hidden="true" /></a>
                  <a href={navigationURL("google", destination.coordinates, stop.coordinates, true)} target="_blank" rel="noopener noreferrer" aria-label={`Walk from ${stop.street} to your destination`}>Walk <Footprints size={12} aria-hidden="true" /></a>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      <p className="search-route-note">
        {hasAlternatives ? (
          <>Find a spot on the first street: about {minuteRange(first.totalLow, first.totalHigh)} min overall. Later stops can add up to {Math.ceil(route.extraDriveMinutes)} min of driving, plus searching. </>
        ) : null}
        These are planning scenarios, not a guarantee of empty spaces.
        {compact ? " Navigation opens one street at a time." : null}
      </p>
    </section>
  );
}
