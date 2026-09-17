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
      {stops.length > 1 ? `Whole circuit · ${stops.length} streets in driving order` : `Directions to ${candidate.street}`}
    </p>
    {stops.length > 1 ? <p className="nav-provider-note">Google Maps: all stops. Waze: one street at a time.</p> : null}
    {showWaze ? <Modal title="Your circuit with Waze." onClose={() => setShowWaze(false)}>
      <p className="waze-intro">Waze accepts one destination at a time. Follow your circuit in order, opening the next street here if you still need a space.</p>
      <ol className="waze-stops">
        {stops.map((stop, index) => <li key={`${stop.street}-${index}`}>
          <a href={navigationURL("waze", stop.coordinates)} target="_blank" rel="noopener noreferrer" aria-label={`Open circuit street ${index + 1}, ${stop.street}, in Waze`}>
            <span className="waze-stop-number">{index + 1}</span>
            <span><small>{index ? `STREET ${index + 1}` : "START HERE"}</small><strong>{stop.street}</strong><span>{stop.capacity} mapped spaces</span></span>
            <ArrowUpRight size={18} />
          </a>
        </li>)}
      </ol>
      <a className="secondary-button" href={googleURL} target="_blank" rel="noopener noreferrer">Open all stops in Google Maps<ExternalLink size={15} /></a>
    </Modal> : null}
  </>;
}
