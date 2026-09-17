import { useState } from "react";
import { ArrowUpRight, ExternalLink, MapPin, Navigation } from "lucide-react";
import type { Candidate, Coordinate } from "../types";
import { navigationURL } from "../lib/api";
import { googleParkingRouteURL, parkingStops } from "../lib/navigation";
import { Modal } from "./Modal";
import "./RouteNavigation.css";

export function RouteNavigation({ candidate, origin }: { candidate: Candidate; origin: Coordinate }) {
  const [showWaze, setShowWaze] = useState(false);
  const stops = parkingStops(candidate);
  const googleURL = googleParkingRouteURL(candidate, origin);
  const route = candidate.searchRoute;
  return <>
    <div className="navigation-buttons">
      {stops.length > 1 ? <button onClick={() => setShowWaze(true)}>
        <Navigation size={16} />Waze<ArrowUpRight size={12} />
      </button> : <a href={navigationURL("waze", candidate.coordinates)} target="_blank" rel="noopener noreferrer">
        <Navigation size={16} />Waze<ExternalLink size={12} />
      </a>}
      <a href={googleURL} target="_blank" rel="noopener noreferrer">
        <MapPin size={16} />Google Maps<ExternalLink size={12} />
      </a>
    </div>
    <p className="nav-caption">
      {stops.length > 1 ? `Full parking route · ${stops.length} streets` : `Directions to ${candidate.street}`}
      {route ? ` · ${Math.floor(route.totalLow)}–${Math.ceil(route.totalHigh)} min overall` : ""}
    </p>
    {stops.length > 1 ? <p className="nav-provider-note">Google Maps: all stops. Waze: one street at a time.</p> : null}
    {showWaze ? <Modal title="Your route with Waze." onClose={() => setShowWaze(false)}>
      <p className="waze-intro">Waze accepts one destination at a time. Start with the first street, then open a backup here if you need it.</p>
      <ol className="waze-stops">
        {stops.map((stop, index) => <li key={`${stop.street}-${index}`}>
          <a href={navigationURL("waze", stop.coordinates)} target="_blank" rel="noopener noreferrer" aria-label={`Open ${index ? `backup ${index}` : "starting street"}, ${stop.street}, in Waze`}>
            <span className="waze-stop-number">{index + 1}</span>
            <span><small>{index ? `BACKUP ${index}` : "START HERE"}</small><strong>{stop.street}</strong><span>{stop.capacity} mapped spaces</span></span>
            <ArrowUpRight size={18} />
          </a>
        </li>)}
      </ol>
      <a className="secondary-button" href={googleURL} target="_blank" rel="noopener noreferrer">Open all stops in Google Maps<ExternalLink size={15} /></a>
    </Modal> : null}
  </>;
}
