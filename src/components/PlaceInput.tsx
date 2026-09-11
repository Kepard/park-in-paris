import { useEffect, useId, useState } from "react";
import { MapPin, LocateFixed, LoaderCircle, X } from "lucide-react";
import { geocode } from "../lib/api";
import type { Place } from "../types";
export function PlaceInput({
  label,
  value,
  onChange,
  origin = false,
  disabled = false,
}: {
  label: string;
  value: Place | null;
  onChange: (place: Place | null) => void;
  origin?: boolean;
  disabled?: boolean;
}) {
  const id = useId(),
    [text, setText] = useState(value?.label || ""),
    [choices, setChoices] = useState<Place[]>([]),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (value) setText(value.label);
  }, [value]);
  useEffect(() => {
    if (!open || text.length < 3 || text === value?.label) {
      setChoices([]);
      setBusy(false);
      return;
    }
    const abort = new AbortController();
    const timer = setTimeout(() => {
      setBusy(true);
      setError("");
      geocode(text, abort.signal)
        .then(setChoices)
        .catch(() => {
          if (!abort.signal.aborted)
            setError("Address search is unavailable. Try again.");
        })
        .finally(() => {
          if (!abort.signal.aborted) setBusy(false);
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [text, open, value]);
  function locate() {
    setBusy(true);
    setError("");
    if (!navigator.geolocation) {
      setError("Location is unavailable. Enter your starting address.");
      setBusy(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        onChange({
          label: "Current location",
          coordinates: [p.coords.longitude, p.coords.latitude],
        });
        setOpen(false);
        setBusy(false);
      },
      () => {
        setError("Location access is unavailable. Enter an address instead.");
        setBusy(false);
      },
      { timeout: 10000, maximumAge: 60000 },
    );
  }
  return (
    <div className="place-field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className={`input-wrap ${origin ? "" : "destination"}`}>
        {origin ? <LocateFixed size={18} /> : <MapPin size={18} />}
        <input
          id={id}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open && choices.length > 0}
          aria-controls={`${id}-list`}
          value={text}
          disabled={disabled}
          placeholder={
            origin ? "Address or current location" : "An address in Paris"
          }
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setText(e.target.value);
            onChange(null);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            if (e.key === "ArrowDown") {
              e.preventDefault();
              document
                .getElementById(`${id}-list`)
                ?.querySelector("button")
                ?.focus();
            }
          }}
        />
        {busy ? (
          <LoaderCircle size={16} className="spin" />
        ) : origin ? (
          <button
            type="button"
            className="icon-button location-button"
            aria-label="Use my current location"
            onClick={locate}
            disabled={disabled}
          >
            <LocateFixed size={16} />
          </button>
        ) : text ? (
          <button
            type="button"
            className="icon-button"
            aria-label="Clear destination"
            onClick={() => {
              setText("");
              onChange(null);
              setOpen(false);
            }}
            disabled={disabled}
          >
            <X size={15} />
          </button>
        ) : null}
      </div>
      {open && choices.length > 0 ? (
        <ul
          id={`${id}-list`}
          className="suggestions"
          role="listbox"
          aria-label={`${label} suggestions`}
        >
          {choices.map((choice, index) => (
            <li
              key={`${choice.label}-${index}`}
              role="option"
              aria-selected={false}
            >
              <button
                type="button"
                onClick={() => {
                  onChange(choice);
                  setText(choice.label);
                  setOpen(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setOpen(false);
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    (
                      e.currentTarget.parentElement?.nextElementSibling
                        ?.firstElementChild as HTMLElement
                    )?.focus();
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    (
                      e.currentTarget.parentElement?.previousElementSibling
                        ?.firstElementChild as HTMLElement
                    )?.focus();
                  }
                }}
              >
                <MapPin size={15} />
                <span>{choice.label}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
