import { useState } from "react";
import {
  Check,
  CheckCircle2,
  CornerDownRight,
  Flag,
  Sparkles,
} from "lucide-react";
import type { SavedTrip, Survey } from "../types";
import { Modal } from "./Modal";
import { parisInput, parseParis } from "../lib/rules";
export function SurveyForm({
  trip,
  onSave,
  onClose,
}: {
  trip: SavedTrip;
  onSave: (survey: Survey) => void;
  onClose: () => void;
}) {
  const [outcome, setOutcome] = useState<Survey["outcome"] | null>(null),
    [minutes, setMinutes] = useState(""),
    [streets, setStreets] = useState("1"),
    [bayType, setBayType] = useState<Survey["bayType"]>("ordinary"),
    [note, setNote] = useState(""),
    [actualStreet, setActualStreet] = useState(""),
    [parkedStopId, setParkedStopId] = useState(""),
    [observedArrival, setObservedArrival] = useState(
      parisInput(new Date(trip.candidate.arrival)),
    ),
    [error, setError] = useState("");
  const routeStops = trip.candidate.searchRoute?.stops;
  function submit(e: React.SubmitEvent) {
    e.preventDefault();
    try {
      if (!outcome) throw new Error("Choose how your parking search ended.");
      const parkedStop = outcome === "here"
        ? routeStops?.find((stop) => stop.id === parkedStopId)
        : undefined;
      if (outcome === "here" && routeStops?.length && !parkedStop)
        throw new Error("Choose the suggested street where you found a space.");
      if (
        minutes.trim() === "" ||
        !Number.isFinite(Number(minutes)) ||
        Number(minutes) < 0 ||
        Number(minutes) > 180
      )
        throw new Error("Enter a search time from 0 to 180 minutes.");
      if (
        !Number.isInteger(Number(streets)) ||
        Number(streets) < 1 ||
        Number(streets) > 50
      )
        throw new Error("Enter between 1 and 50 streets tried.");
      const arrival = parseParis(observedArrival);
      if (arrival.getTime() > Date.now() + 60000)
        throw new Error("The actual search time cannot be in the future.");
      onSave({
        outcome,
        searchMinutes: Number(minutes),
        streetsTried: Number(streets),
        bayType,
        note: note.trim().slice(0, 500),
        submittedAt: new Date().toISOString(),
        actualStreet:
          outcome === "here"
            ? parkedStop?.street ?? trip.candidate.street
            : actualStreet.trim(),
        ...(parkedStop ? { parkedStopId: parkedStop.id } : {}),
        observedArrival: arrival.toISOString(),
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Modal title="How did parking go?" onClose={onClose}>
      <div className="survey-intro">
        <span className="survey-icon">
          <Sparkles size={23} />
        </span>
        <p>
          A few seconds now.
          <br />
          <strong>Better parking estimates later.</strong>
        </p>
      </div>
      <p className="survey-street">
        Your plan: {trip.candidate.street}
        {routeStops && routeStops.length > 1 ? ` + ${routeStops.length - 1} nearby streets` : ""}
      </p>
      <form onSubmit={submit}>
        <fieldset className="outcome-options">
          <legend>Where did you end up?</legend>
          {(
            [
              {
                value: "here",
                label: routeStops?.length ? "On a suggested street" : "On the suggested street",
                icon: CheckCircle2,
              },
              {
                value: "elsewhere",
                label: "Parked somewhere else",
                icon: CornerDownRight,
              },
              { value: "gave-up", label: "Gave up searching", icon: Flag },
            ] as const
          ).map((o) => (
            <label
              key={o.value}
              className={outcome === o.value ? "chosen" : ""}
            >
              <input
                type="radio"
                name="outcome"
                value={o.value}
                checked={outcome === o.value}
                onChange={() => setOutcome(o.value)}
              />
              <o.icon size={18} />
              <span>{o.label}</span>
              {outcome === o.value ? <Check size={16} /> : null}
            </label>
          ))}
        </fieldset>
        {outcome === "here" && routeStops?.length ? (
          <label className="survey-label">
            Which street had a space?
            <select
              required
              value={parkedStopId}
              onChange={(event) => setParkedStopId(event.target.value)}
            >
              <option value="" disabled>Choose the street where you parked</option>
              {routeStops.map((stop, index) => (
                <option key={stop.id} value={stop.id}>{index + 1}. {stop.street}</option>
              ))}
            </select>
            <span>This helps us learn from the right street.</span>
          </label>
        ) : null}
        <div className="survey-grid">
          <label>
            Time spent searching <span>minutes</span>
            <input
              required
              type="number"
              min="0"
              max="180"
              inputMode="numeric"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              placeholder="e.g. 6"
            />
          </label>
          <label>
            Streets you tried
            <input
              required
              type="number"
              min="1"
              max="50"
              inputMode="numeric"
              value={streets}
              onChange={(e) => setStreets(e.target.value)}
            />
          </label>
        </div>
        <label className="survey-label">
          When did you actually start looking?
          <input
            required
            type="datetime-local"
            value={observedArrival}
            onChange={(e) => setObservedArrival(e.target.value)}
          />
          <span>Paris time · correct this if your plans changed.</span>
        </label>
        {outcome === "elsewhere" ? (
          <label className="survey-label">
            Where did you park? <span>Optional</span>
            <input
              value={actualStreet}
              onChange={(e) => setActualStreet(e.target.value)}
              maxLength={150}
              placeholder="Street or neighbourhood"
            />
          </label>
        ) : null}
        {outcome !== "gave-up" ? (
          <label className="survey-label">
            What kind of space?
            <select
              value={bayType}
              onChange={(e) => setBayType(e.target.value as Survey["bayType"])}
            >
              <option value="ordinary">Ordinary street parking</option>
              <option value="delivery">Shared livraison bay</option>
              <option value="other">Something else</option>
            </select>
          </label>
        ) : null}
        <label className="survey-label">
          Anything worth remembering? <span>Optional</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder="Roadworks, a busy evening, an easier side street…"
          />
        </label>
        {error ? (
          <p role="alert" className="error-message">
            {error}
          </p>
        ) : null}
        <button type="submit" className="primary-button">
          Save my experience <Check size={19} />
        </button>
        <p className="privacy-note">
          Saved privately on the server, linked to this browser. Export your trips any time.
        </p>
      </form>
    </Modal>
  );
}
