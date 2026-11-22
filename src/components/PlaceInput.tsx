import { useEffect, useId, useRef, useState } from "react";
import { Circle, LocateFixed, LoaderCircle, MapPin, X } from "lucide-react";
import { geocode } from "../lib/api";
import type { Place } from "../types";

export function PlaceInput({ label, value, onChange, origin = false, disabled = false }: {
  label: string;
  value: Place | null;
  onChange: (place: Place | null) => void;
  origin?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const locationRequest = useRef(0);
  const [text, setText] = useState(value?.label || "");
  const [choices, setChoices] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [locating, setLocating] = useState(false);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState("");
  const showing = open && choices.length > 0 && !disabled;

  useEffect(() => {
    if (value) setText(value.label);
  }, [value]);
  useEffect(() => {
    if (!open || disabled || text.trim().length < 3 || text === value?.label) return;
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await geocode(text.trim(), abort.signal, !origin);
        if (!abort.signal.aborted) {
          setChoices(results);
          setMessage(results.length ? "" : "No addresses found. Try a street name or postcode.");
        }
      } catch {
        if (!abort.signal.aborted) setMessage("Address search is unavailable. Please try again.");
      } finally {
        if (!abort.signal.aborted) setSearching(false);
      }
    }, 250);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [text, value, open, origin, disabled]);

  function close() {
    setOpen(false);
    setActive(-1);
    setChoices([]);
    setSearching(false);
  }
  function choose(place: Place) {
    onChange(place);
    setText(place.label);
    setMessage("");
    close();
  }
  function locate() {
    if (!navigator.geolocation) {
      setMessage("Location is unavailable. Enter a starting address.");
      return;
    }
    const request = ++locationRequest.current;
    close();
    onChange(null);
    setText("");
    setMessage("");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(position => {
      if (request !== locationRequest.current) return;
      choose({ label: "Current location", coordinates: [position.coords.longitude, position.coords.latitude] });
      setLocating(false);
    }, () => {
      if (request !== locationRequest.current) return;
      if (value) choose(value);
      setMessage("Couldn’t access your location. Enter a starting address.");
      setLocating(false);
    }, { timeout: 10000, maximumAge: 60000 });
  }

  return <div className="place-field" onBlur={e => {
    if (!e.currentTarget.contains(e.relatedTarget)) close();
  }}>
    <div className="address-row">
      <span className={origin ? "location-symbol origin" : "location-symbol"} aria-hidden="true">
        {origin ? <Circle size={14} /> : <MapPin size={18} />}
      </span>
      <div className="address-text">
        <label htmlFor={id}>{label}</label>
        <input id={id} ref={input} role="combobox" aria-autocomplete="list" autoComplete="off"
          aria-controls={showing ? `${id}-list` : undefined} aria-expanded={showing}
          aria-activedescendant={showing && active >= 0 ? `${id}-option-${active}` : undefined}
          value={text} disabled={disabled}
          placeholder={origin ? "Starting address" : "Address or place in Paris"}
          onFocus={() => setOpen(true)}
          onChange={e => {
            locationRequest.current++;
            setLocating(false);
            setText(e.target.value); onChange(null); setOpen(true);
            setChoices([]); setActive(-1); setMessage(""); setSearching(false);
          }}
          onKeyDown={e => {
            if (e.key === "Escape") { close(); return; }
            if (!showing) return;
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setActive(i => e.key === "ArrowDown" ? (i + 1) % choices.length : (i <= 0 ? choices.length - 1 : i - 1));
            } else if (e.key === "Enter") {
              e.preventDefault(); choose(choices[Math.max(0, active)]);
            }
          }}
        />
      </div>
      {locating || searching ? <LoaderCircle size={16} className="spin" aria-label="Looking up location" /> :
        origin ? <button type="button" className="icon-button" aria-label="Use my current location" onClick={locate} disabled={disabled}><LocateFixed size={17} /></button> :
        text ? <button type="button" className="icon-button" aria-label="Clear destination" disabled={disabled} onClick={() => {
          onChange(null); setText(""); setMessage(""); close(); input.current?.focus();
        }}><X size={16} /></button> : null}
    </div>
    {showing && <ul id={`${id}-list`} className="suggestions" role="listbox" aria-label={`${label} suggestions`}>
      {choices.map((place, i) => <li key={place.label} id={`${id}-option-${i}`} role="option"
        aria-selected={active === i} onMouseDown={e => e.preventDefault()} onClick={() => choose(place)}>
        <MapPin size={15} /><span>{place.label}</span>
      </li>)}
    </ul>}
    {message && <p className="field-error" role="status">{message}</p>}
  </div>;
}
