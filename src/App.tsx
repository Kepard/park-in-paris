import {
  ArrowUpRight,
  Footprints,
  MapPin,
  Route,
  Clock3,
  ArrowLeft,
  ArrowRight,
  CircleParking,
  LoaderCircle,
  X,
  Info,
  ExternalLink,
  Download,
  Trash2,
  SlidersHorizontal,
  CalendarDays,
  ChevronDown,
  CheckCircle2,
  ScanEye,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { PlaceInput } from "./components/PlaceInput";
import { Modal } from "./components/Modal";
import { SurveyForm } from "./components/SurveyForm";
import { RouteNavigation } from "./components/RouteNavigation";
import { CircuitCard } from "./components/CircuitCard";
import { CIRCUIT_LABELS, circuitSummary } from "./lib/circuitSummary";
import { GARNIER, MONTREUIL, navigationURL, streetViewURL } from "./lib/api";
import { defaultTimes, parseParis } from "./lib/rules";
import { planTrip } from "./lib/planner";
import { exportTrips } from "./lib/storage";
import { useTripStore } from "./lib/useTripStore";
import { usePlanTool } from "./lib/usePlanTool";
import type { Place, Plan, SavedTrip, Survey, TripInput, SearchTrace } from "./types";

const MapView = lazy(() => import("./components/MapView")
  .then(module => ({ default: module.MapView }))
  .catch(() => ({ default: () => <div className="map-error" role="status">
    <strong>Map unavailable</strong><span>You can still compare circuits and open directions.</span>
  </div> })));
const inventoryVersion = import.meta.env.VITE_INVENTORY_VERSION;

function scheduleLabel(departure: string, returnAt: string) {
  try {
    const start = parseParis(departure), end = parseParis(returnAt);
    const format = (date: Date, showDate: boolean) => new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Paris", ...(showDate && { day: "numeric", month: "short" }),
      hour: "2-digit", minute: "2-digit",
    }).format(date);
    return `${format(start, true)} → ${format(end, departure.slice(0, 10) !== returnAt.slice(0, 10))}`;
  } catch { return "Choose departure and return times"; }
}
const formatDate = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "Europe/Paris",
  }).format(new Date(iso));
function initialPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem("park-in-paris.preferences.v1") || "{}");
    return saved && typeof saved === "object" ? saved : {};
  } catch {
    return {};
  }
}
function revealMap() {
  if (innerWidth <= 760) window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
}

export default function App() {
  const { trips, saveTrips, status: syncStatus, error: syncError, sync, canImportLegacy, legacyMessage } = useTripStore();
  const [origin, setOrigin] = useState<Place | null>(MONTREUIL),
    [destination, setDestination] = useState<Place | null>(GARNIER),
    [times, setTimes] = useState(defaultTimes),
    [prefs] = useState(initialPrefs),
    [maxWalk, setMaxWalk] = useState<number>([5, 10, 15, 20, 25, 30].includes(prefs.maxWalk) ? prefs.maxWalk : 30),
    [rushAllowance, setRushAllowance] = useState(prefs.rushAllowance !== false),
    [useExperience, setUseExperience] = useState(prefs.useExperience !== false);
  const [plan, setPlan] = useState<Plan | null>(null),
    [traces, setTraces] = useState<SearchTrace[]>([]),
    [selected, setSelected] = useState(0),
    [selectedStop, setSelectedStop] = useState(0),
    [focusMode, setFocusMode] = useState<"circuit" | "street">("circuit"),
    [focusRequest, setFocusRequest] = useState(0),
    [searching, setSearching] = useState(false),
    [stage, setStage] = useState("Reading the Paris parking inventory"),
    [progress, setProgress] = useState(0),
    [error, setError] = useState(""),
    [tab, setTab] = useState<"plan" | "results">("plan");
  const [showHistory, setShowHistory] = useState(false),
    [showInfo, setShowInfo] = useState(false),
    [showSettings, setShowSettings] = useState(false),
    [surveyId, setSurveyId] = useState<string | null>(null),
    [toast, setToast] = useState(""),
    [reminderDismissed, setReminderDismissed] = useState<string | null>(null),
    [clock, setClock] = useState(Date.now());
  const abortRef = useRef<AbortController | null>(null);
  const resultsTitle = useRef<HTMLHeadingElement>(null);
  const active = trips.find((t) => t.status === "active"),
    surveyTrip = trips.find((t) => t.id === surveyId),
    candidate = plan?.candidates[selected],
    summary = candidate ? circuitSummary(candidate) : undefined,
    focusedStreet = candidate?.searchRoute?.stops[selectedStop] ?? candidate;
  const selectCandidate = useCallback((index: number) => {
    setSelected(index); setSelectedStop(0); setFocusMode("circuit"); setFocusRequest(n => n + 1); revealMap();
  }, []);
  const selectStop = useCallback((index: number) => {
    setSelectedStop(index); setFocusMode("street"); setFocusRequest(n => n + 1); revealMap();
  }, []);
  usePlanTool(tab === "results" ? plan : null);
  useEffect(() => { if (tab === "results") resultsTitle.current?.focus({ preventScroll: true }); }, [tab]);
  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    try {
      localStorage.setItem(
        "park-in-paris.preferences.v1",
        JSON.stringify({ maxWalk, rushAllowance, useExperience }),
      );
    } catch {
      /* Preferences are optional when browser storage is disabled. */
    }
  }, [maxWalk, rushAllowance, useExperience]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!active) return;
    const update = () => setClock(Date.now()),
      timer = setInterval(update, 15000);
    update();
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [active?.id]);
  useEffect(() => {
    if (
      active &&
      parseParis(active.input.returnAt).getTime() <= clock &&
      reminderDismissed !== active.id &&
      !showHistory
    )
      setSurveyId(active.id);
  }, [active, clock, reminderDismissed, showHistory]);
  function updateTrips(next: SavedTrip[]) {
    try {
      saveTrips(next);
      return true;
    } catch {
      setToast(
        "Browser storage is full or unavailable. Please export your trips before continuing.",
      );
      return false;
    }
  }
  async function search(event?: React.SubmitEvent) {
    event?.preventDefault();
    setError("");
    if (!origin || !destination) {
      setError("Choose a suggested address for both locations.");
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setSearching(true);
    setTraces([]);
    revealMap();
    setProgress(2);
    setStage("Reading the Paris parking inventory");
    try {
      const input: TripInput = {
        origin,
        destination,
        ...times,
        maxWalk,
        rushAllowance,
        useExperience,
      };
      const result = await planTrip(
        input,
        trips,
        (s, n) => {
          setStage(s);
          if (n !== undefined) setProgress(n);
        },
        controller.signal,
        trace => { if (!controller.signal.aborted) setTraces(current => [...current.filter(t => t.id !== trace.id), trace]); },
      );
      if (controller.signal.aborted) return;
      setPlan(result);
      setSelected(0);
      setSelectedStop(0);
      setFocusMode("circuit");
      setProgress(100);
      setTab("results");
    } catch (e) {
      if (!controller.signal.aborted)
        setError(
          (e as Error).message || "Something went wrong. Please try again.",
        );
    } finally {
      if (abortRef.current === controller) setSearching(false);
    }
  }
  function cancel() {
    abortRef.current?.abort();
    setSearching(false);
  }
  function startTrip() {
    if (!plan || !candidate) return;
    if (active) {
      setToast("Finish your active trip before starting another.");
      setShowHistory(true);
      return;
    }
    const trip: SavedTrip = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      status: "active",
      input: plan.input,
      candidate,
      modelVersion: plan.modelVersion,
    };
    if (updateTrips([trip, ...trips])) {
      setToast("Circuit saved. Open your driving route below.");
      setReminderDismissed(null);
    }
  }
  function saveSurvey(survey: Survey) {
    if (!surveyId) return;
    const next = trips.map((t) =>
      t.id === surveyId
        ? {
            ...t,
            status: "completed" as const,
            survey,
            completedAt: new Date().toISOString(),
          }
        : t,
    );
    if (updateTrips(next)) {
      setSurveyId(null);
      setToast("Parking experience saved.");
    }
  }
  const due = active && parseParis(active.input.returnAt).getTime() <= clock;
  return (
    <main className={`app ${tab === "results" ? "has-results" : ""}`}>
      <a className="skip-link" href="#trip-planner">Skip to planner</a>
      <header className="topbar">
        <a
          className="brand"
          href={import.meta.env.BASE_URL}
          onClick={(e) => {
            e.preventDefault();
            if (!searching) setTab("plan");
          }}
        >
          <span className="brand-icon" aria-hidden="true">P<span>↗</span></span>
          <span>Park in Paris</span>
        </a>
        <nav className="top-actions" aria-label="Planner tools">
          <button className="help-button" onClick={() => setShowInfo(true)} aria-label="How estimates work">
            <Info size={16} /><span>How it works</span>
          </button>
          <button className="history-button" onClick={() => setShowHistory(true)}>
            <Clock3 size={17} />
            Your trips
            {trips.length ? (
              <span className="count-badge">{trips.length}</span>
            ) : null}
          </button>
        </nav>
      </header>
      {active ? (
        <div className="active-trip-bar">
          <span>
            <span className="small-dot" />
            {due ? "Back from your trip?" : "Trip in progress"}{" "}
            <strong>{active.candidate.circuit ? CIRCUIT_LABELS[active.candidate.circuit.strategy] : active.candidate.street}</strong>
          </span>
          <button onClick={() => setSurveyId(active.id)}>
            Finish & review <ArrowUpRight size={15} />
          </button>
        </div>
      ) : null}
      <section className="map-pane" aria-label="Parking map">
        <Suspense fallback={<div className="map-loading" role="status">Loading map…</div>}>
          <MapView
            plan={tab === "results" ? plan : null}
            selected={selected}
            onSelect={selectCandidate}
            selectedStop={selectedStop}
            onSelectStop={selectStop}
            focusRequest={focusRequest}
            focusMode={focusMode}
            destination={destination}
            origin={origin}
            searching={searching}
            searchPhase={progress >= 8 ? "streets" : "journey"}
            traces={traces}
          />
        </Suspense>
        {searching && <div className="search-display">
            <div className="search-heading">
              <Route size={18} aria-hidden="true" />
              <span role="status">{stage}</span>
              <button type="button" className="icon-button" aria-label="Cancel search" onClick={cancel}><X size={16} /></button>
            </div>
            <div className="search-progress" role="progressbar" aria-label="Parking search progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
              <span style={{ width: `${Math.max(3, progress)}%` }} />
            </div>
        </div>}
      </section>
      <section className="planner" id="trip-planner" key={tab} aria-label="Parking planner" tabIndex={-1}>
        {tab === "plan" ? (
          <form onSubmit={search} noValidate>
            <h1>Plan your trip</h1>
            <p className="intro">Find street parking within walking distance of your destination.</p>
            <div className="addresses">
              <PlaceInput
                label="From"
                value={origin}
                onChange={setOrigin}
                origin
                disabled={searching}
              />
              <PlaceInput
                label="Destination"
                value={destination}
                onChange={setDestination}
                disabled={searching}
              />
            </div>
            <details className="schedule">
              <summary><CalendarDays size={18} /><span>Trip times <small>Paris time</small></span><ChevronDown size={15} />
                <strong>{scheduleLabel(times.departure, times.returnAt)}</strong>
              </summary>
              <div className="form-row">
                <label>
                  Leave at
                  <input
                    aria-label="Departure date and time, Paris time"
                    required
                    type="datetime-local"
                    value={times.departure}
                    onChange={(e) =>
                      setTimes({ ...times, departure: e.target.value })
                    }
                    disabled={searching}
                  />
                </label>
                <label>
                  Back at the car
                  <input
                    aria-label="Return date and time, Paris time"
                    required
                    type="datetime-local"
                    value={times.returnAt}
                    onChange={(e) =>
                      setTimes({ ...times, returnAt: e.target.value })
                    }
                    disabled={searching}
                  />
                </label>
              </div>
            </details>
            <div className="walk-label">
              <label htmlFor="max-walk">
                <Footprints size={18} /> Maximum walk
              </label>
              <strong>
                {maxWalk} <small>min</small>
              </strong>
            </div>
            <input
              id="max-walk"
              className="walk-slider"
              type="range"
              min="5"
              max="30"
              step="5"
              aria-valuetext={`${maxWalk} minutes`}
              style={{ "--walk-fill": `${(maxWalk - 5) * 4}%` } as React.CSSProperties}
              value={maxWalk}
              onChange={(e) => setMaxWalk(Number(e.target.value))}
              disabled={searching}
            />
            <div className="range-labels">
              <span>5 min</span>
              <span>30 min</span>
            </div>
            <button
              type="button"
              className="preferences-toggle"
              onClick={() => setShowSettings(!showSettings)}
              aria-expanded={showSettings}
            >
              <SlidersHorizontal size={14} />
              Preferences <ChevronDown size={14} />
            </button>
            {showSettings ? (
              <div className="preferences">
                <label>
                  <input
                    type="checkbox"
                    checked={rushAllowance}
                    onChange={(e) => setRushAllowance(e.target.checked)}
                    disabled={searching}
                  />
                  <span>
                    Allow extra time for typical congestion
                    <small>
                      A time-of-day allowance, without live traffic.
                    </small>
                  </span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={useExperience}
                    onChange={(e) => setUseExperience(e.target.checked)}
                    disabled={searching}
                  />
                  <span>
                    Use my previous parking experiences
                    <small>
                      Small adjustments after three similar successful trips.
                    </small>
                  </span>
                </label>
              </div>
            ) : null}
            {error ? (
              <p className="error-message" role="alert">
                {error}
              </p>
            ) : null}
            <button
              type="submit"
              className="primary-button"
              disabled={searching}
            >
              {searching ? (
                <>
                  <span>Finding circuits…</span>
                  <LoaderCircle size={21} className="spin" />
                </>
              ) : (
                <>
                  Find parking circuits <ArrowRight size={18} />
                </>
              )}
            </button>
            <a className="inventory-note" href="https://opendata.paris.fr/explore/dataset/stationnement-sur-voie-publique-emprises/" target="_blank" rel="noopener noreferrer">
              Parking data from Ville de Paris <ArrowUpRight size={12} />
            </a>
          </form>
        ) : plan && candidate ? (
          <>
            <button className="back-button" onClick={() => setTab("plan")}>
              <ArrowLeft size={16} />
              Adjust your trip
            </button>
            <h1 ref={resultsTitle} tabIndex={-1}>Your circuits</h1>
            <p className="result-destination"><MapPin size={15} />{plan.input.destination.label.split(" · ")[0]}</p>
            <div className="result-list">
              {plan.candidates.map((c, index) => (
                <CircuitCard
                  key={`${c.circuit?.strategy ?? index}:${c.searchRoute?.stops.map(stop => stop.id).join(">") ?? c.id}`}
                  candidate={c}
                  selected={selected === index}
                  onSelect={() => selectCandidate(index)}
                />
              ))}
            </div>
            {summary && <div className="circuit-summary">
              <span>Estimated time to destination</span>
              <strong>{Math.floor(summary.totalLow)}–{Math.ceil(summary.totalHigh)} <small>min</small></strong>
              <p>Includes the {Math.ceil(candidate.driveMinutes)} min drive to the first street, parking search and walk.</p>
            </div>}
            <button className="primary-button" onClick={startTrip} disabled={!!active}>
              {active ? "Trip in progress" : "Use this circuit"}<ArrowRight size={18} />
            </button>
            <RouteNavigation key={candidate.id + ":" + selected} candidate={candidate} origin={plan.input.origin.coordinates} />
            <div className="street-preview">
              <h2>Streets in driving order</h2>
              <ol className="street-list">
                {(candidate.searchRoute?.stops ?? [candidate]).map((stop, index) =>
                  <li key={stop.id}><button onClick={() => selectStop(index)} aria-pressed={index === selectedStop}>
                    <span className="stop-number">{index + 1}</span><span>{stop.street}</span>
                    <small>{stop.capacity} spaces</small>
                  </button></li>
                )}
              </ol>
              {focusedStreet && <>
                <p className="parking-type"><CircleParking size={15} />{focusedStreet.parkingType === "paid" ? "Paid parking" : focusedStreet.parkingType === "mixed" ? "Mixed parking" : "Free or shared parking"}
                  {focusedStreet.sharedCapacity ? ` · ${focusedStreet.sharedCapacity} shared delivery spaces` : ""}</p>
                <div className="street-links">
                  <a href={streetViewURL(focusedStreet.coordinates)} aria-label={`Street View on ${focusedStreet.street}`} target="_blank" rel="noopener noreferrer"><ScanEye size={15} /> Street View <ArrowUpRight size={13} /></a>
                  <a href={navigationURL("google", plan.input.destination.coordinates, focusedStreet.coordinates, true)} aria-label={`Walk from ${focusedStreet.street} to your destination`} target="_blank" rel="noopener noreferrer"><Footprints size={15} /> Walking route <ArrowUpRight size={13} /></a>
                </div>
              </>}
            </div>
            {candidate.learnedFrom > 0 && <p className="result-caveat">Adjusted using {candidate.learnedFrom} similar first-street visits.</p>}
            <p className="result-caveat">
              Counts show mapped capacity. Check availability and signs when you park.
            </p>
            <div className="source-note">
              <span>{plan.compared} areas compared</span>
              <button onClick={() => setShowInfo(true)}>
                About these estimates <Info size={13} />
              </button>
            </div>
            {plan.warnings.map((w) => (
              <p className="field-error" key={w}>
                {w}
              </p>
            ))}
          </>
        ) : null}
      </section>
      {showInfo ? (
        <Modal title="How estimates work" onClose={() => setShowInfo(false)}>
          <div className="info-copy">
            <p><strong>How circuits are chosen.</strong> We compare up to four nearby streets per circuit. More eligible spaces improve a circuit’s score. Longer drives and walks reduce it. Every counted section has a checked walking route within your limit.</p>
            <p><strong>Which circuit to pick.</strong> Golden balance weighs spaces, driving and walking together. Closest walk favours proximity. More parking options favours capacity. Similar options are combined.</p>
            <p><strong>What the times mean.</strong> The range covers parking on an early or later street, then walking. Search time uses mapped capacity, district and time of day. Optional congestion adds 10–35% to the drive. Live occupancy and traffic are unavailable.</p>
            <p><strong>Parking rules.</strong> Shared delivery bays must allow parking for your whole stay. Permanent delivery bays, special hours and the two Bois are excluded. The planner limits paid visitor stays to six hours. Check the signs for temporary changes.</p>
            <p><strong>Your trips.</strong> History and feedback sync privately in this browser. Three similar first-street successes can adjust a future estimate. Export your trips before clearing browser data.</p>
            <div className="source-links">
              <a
                href="https://opendata.paris.fr/explore/dataset/stationnement-sur-voie-publique-emprises/"
                target="_blank"
                rel="noopener noreferrer"
              >
                Paris parking data · ODbL <ExternalLink size={13} />
              </a>
              <a
                href="https://cartes.gouv.fr/aide/fr/guides-utilisateur/utiliser-les-services-de-la-geoplateforme/calcul-itineraire/"
                target="_blank"
                rel="noopener noreferrer"
              >
                IGN routing · open reference data <ExternalLink size={13} />
              </a>
              <a
                href="https://www.paris.fr/pages/stationnement-foire-aux-questions-7571"
                target="_blank"
                rel="noopener noreferrer"
              >
                Official parking rules <ExternalLink size={13} />
              </a>
              <span>{plan ? "Inventory used for this trip" : "Bundled inventory"} · {formatDate(plan?.inventoryDate ?? inventoryVersion)} {new Date(plan?.inventoryDate ?? inventoryVersion).getUTCFullYear()}</span>
            </div>
          </div>
        </Modal>
      ) : null}
      {showHistory ? (
        <Modal
          title="Your trips"
          onClose={() => setShowHistory(false)}
        >
          <div className={`sync-status ${syncStatus}`} role="status">
            {syncStatus === "saved" ? <CheckCircle2 size={16} /> : syncStatus === "syncing" ? <LoaderCircle size={16} className="spin" /> : <Info size={16} />}
            <span>{syncStatus === "saved" ? "Saved privately on the server" : syncStatus === "syncing" ? "Syncing your history…" : "Saved on this device · sync pending"}</span>
            {syncStatus === "offline" ? <button onClick={() => void sync()}>Retry</button> : null}
          </div>
          {syncError ? <p className="field-error">{syncError}</p> : null}
          {canImportLegacy && <details className="legacy-import">
            <summary>Trips from the old address</summary>
            <p>If you used the planner on kepard.dev, you can try recovering that browser’s history.</p>
            <button className="text-button" disabled={syncStatus === "syncing"} onClick={() => void sync(true)}>Check old address <ArrowRight size={14} /></button>
          </details>}
          {legacyMessage && <p className="field-error" role="status">{legacyMessage}</p>}
          {trips.length ? (
            <>
              <p className="history-intro">
                Plans and parking feedback saved for this browser.
              </p>
              <div className="trip-list">
                {trips.map((t) => (
                  <article className="trip-item" key={t.id}>
                    <div>
                      <span className={`trip-status ${t.status}`}>
                        {t.status === "active" ? "IN PROGRESS" : "COMPLETED"}
                      </span>
                      <time>{formatDate(t.createdAt)}</time>
                    </div>
                    <h3>{t.input.destination.label.split(" · ")[0]}</h3>
                    <p>{t.candidate.circuit ? `${CIRCUIT_LABELS[t.candidate.circuit.strategy]} · ${circuitSummary(t.candidate).capacity} mapped spaces` : `${t.candidate.searchRoute ? "Circuit from " : ""}${t.candidate.street}`}</p>
                    {t.candidate.searchRoute ? <p className="trip-circuit-streets">{t.candidate.searchRoute.stops.map(stop => stop.street).join(" → ")}</p> : null}
                    {t.survey ? (
                      <div className="trip-feedback">
                        <CheckCircle2 size={15} />
                        {t.survey.outcome === "gave-up"
                          ? `Stopped after ${t.survey.searchMinutes} min`
                          : t.survey.outcome === "elsewhere"
                            ? `Parked elsewhere · ${t.survey.searchMinutes} min search`
                            : `Parked on ${t.survey.actualStreet || t.candidate.street} · ${t.survey.searchMinutes} min search`}
                      </div>
                    ) : (
                      <>
                        <RouteNavigation candidate={t.candidate} origin={t.input.origin.coordinates} />
                        <button
                          className="text-button"
                          onClick={() => {
                            setShowHistory(false);
                            setSurveyId(t.id);
                          }}
                        >
                          Finish trip & share experience{" "}
                          <ArrowRight size={14} />
                        </button>
                      </>
                    )}
                    <button
                      className="delete-trip"
                      onClick={() => {
                        if (
                          window.confirm(
                            "Delete this trip and its feedback from the server and this device?",
                          )
                        )
                          updateTrips(trips.filter((x) => x.id !== t.id));
                      }}
                      aria-label={`Delete trip to ${t.input.destination.label}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </article>
                ))}
              </div>
              <button
                className="secondary-button"
                onClick={() => exportTrips(trips)}
              >
                <Download size={16} />
                Export my trips
              </button>
            </>
          ) : (
            <div className="empty-history">
              <Route size={40} />
              <h3>No saved trips yet</h3>
              <p>
                Choose a parking plan, then save your experience when you
                return.
              </p>
              <button
                className="primary-button"
                onClick={() => setShowHistory(false)}
              >
                Plan a trip <ArrowUpRight size={19} />
              </button>
            </div>
          )}
        </Modal>
      ) : null}
      {surveyTrip ? (
        <SurveyForm
          key={surveyTrip.id}
          trip={surveyTrip}
          onSave={saveSurvey}
          onClose={() => {
            setReminderDismissed(surveyTrip.id);
            setSurveyId(null);
          }}
        />
      ) : null}
      {toast && <div className="toast" role="status">
            <CheckCircle2 size={18} />
            {toast}
            <button
              className="icon-button"
              aria-label="Dismiss notification"
              onClick={() => setToast("")}
            >
              <X size={16} />
            </button>
      </div>}
    </main>
  );
}
