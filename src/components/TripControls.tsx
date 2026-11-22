import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { CalendarDays, Check, ChevronRight, Footprints } from "lucide-react";
import { useState } from "react";
import { parseParis } from "../lib/rules";
import { Modal } from "./Modal";

type TripTimes = { departure: string; returnAt: string };

function scheduleLabel({ departure, returnAt }: TripTimes) {
  try {
    const format = (date: Date, showDate: boolean) => new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Paris", ...(showDate && { day: "numeric", month: "short" }),
      hour: "2-digit", minute: "2-digit",
    }).format(date);
    return `${format(parseParis(departure), true)} → ${format(parseParis(returnAt), departure.slice(0, 10) !== returnAt.slice(0, 10))}`;
  } catch { return "Choose departure and return times"; }
}

export function ScheduleControl({ times, onChange }: {
  times: TripTimes;
  onChange: (value: TripTimes) => void;
}) {
  const [draft, setDraft] = useState<TripTimes | null>(null);
  const [error, setError] = useState("");
  return <>
    <button type="button" className="schedule-button" aria-haspopup="dialog" onClick={() => { setDraft(times); setError(""); }}>
      <CalendarDays size={18} /><span>Trip times</span><strong>{scheduleLabel(times)}</strong><ChevronRight size={15} />
    </button>
    <AnimatePresence>{draft && <Modal title="Trip times" onClose={() => setDraft(null)}>
      <div className="form-row">
        <label>Leave at<input type="datetime-local" aria-label="Departure date and time, Paris time"
          required value={draft.departure} onChange={e => setDraft({ ...draft, departure: e.target.value })} /></label>
        <label>Back at the car<input type="datetime-local" aria-label="Return date and time, Paris time"
          required value={draft.returnAt} onChange={e => setDraft({ ...draft, returnAt: e.target.value })} /></label>
      </div>
      <p className="dialog-hint">Both times are local to Paris.</p>
      {error && <p role="alert" className="error-message">{error}</p>}
      <button className="primary-button" type="button" onClick={() => {
        try {
          if (parseParis(draft.returnAt) <= parseParis(draft.departure)) throw new Error("Choose a return time after departure.");
          onChange(draft); setDraft(null);
        } catch (e) { setError((e as Error).message); }
      }}>Set trip times <Check size={18} /></button>
    </Modal>}</AnimatePresence>
  </>;
}

const walkingLimits = [5, 10, 15, 20, 25, 30];
export function WalkControl({ value, onChange }: { value: number; onChange: (minutes: number) => void }) {
  return <fieldset className="walk-control">
    <legend><span><Footprints size={18} /> Maximum walk</span><small>minutes</small></legend>
    <div className="walk-options">{walkingLimits.map(minutes =>
      <label key={minutes} className={value === minutes ? "chosen" : ""}>
        <input type="radio" className="sr-only" name="max-walk" aria-label={`${minutes} minutes`}
          checked={value === minutes} onChange={() => onChange(minutes)} />
        {value === minutes && <m.span className="walk-highlight" layoutId="walk-limit" />}
        <span>{minutes}</span>
      </label>
    )}</div>
  </fieldset>;
}
