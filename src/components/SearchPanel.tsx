import { Route, X } from "lucide-react";
import * as m from "motion/react-m";

export function SearchPanel({ stage, progress, cancel }: { stage: string; progress: number; cancel: () => void }) {
  const title = progress < 8 ? "Tracing your drive" : progress < 60 ? "Checking nearby streets"
    : progress < 83 ? "Connecting streets" : "Comparing circuits";
  return <m.div className="search-panel" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
    <div className="search-topline">
      <span className="search-symbol"><Route size={20} /></span>
      <h1 tabIndex={-1} data-panel-focus aria-live="polite" aria-atomic="true">
        <m.span key={title} initial={{ opacity: 0.5, y: 3 }} animate={{ opacity: 1, y: 0 }}>{title}</m.span>
      </h1>
      <button type="button" className="icon-button" aria-label="Cancel search" onClick={cancel}><X size={18} /></button>
    </div>
    <div className="search-progress" role="progressbar" aria-label="Parking search progress"
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
      <m.span initial={false} animate={{ scaleX: Math.max(0.015, progress / 100) }} />
    </div>
    <div className="search-stage"><span>{stage}</span><strong>{progress}%</strong></div>
  </m.div>;
}
