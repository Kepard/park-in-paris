import {
  ArrowUpRight,
  Footprints,
  MapPin,
  Route,
  Clock3,
  ArrowLeft,
  ArrowRight,
  Car,
  CircleParking,
  LoaderCircle,
  X,
  Info,
  ExternalLink,
  Download,
  Trash2,
  SlidersHorizontal,
  CheckCircle2,
  Sparkles,
  ScanEye,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { PlaceInput } from "./components/PlaceInput";
import { MapView } from "./components/MapView";
import { Modal } from "./components/Modal";
import { SurveyForm } from "./components/SurveyForm";
import { RouteNavigation } from "./components/RouteNavigation";
import { CircuitCard, walkingRange } from "./components/CircuitCard";
import { CIRCUIT_LABELS, circuitSummary } from "./lib/circuitSummary";
import { GARNIER, MONTREUIL, navigationURL, streetViewURL } from "./lib/api";
import { defaultTimes, parseParis } from "./lib/rules";
import { planTrip } from "./lib/planner";
import { exportTrips } from "./lib/storage";
import { useTripStore } from "./lib/useTripStore";
import { usePlanTool } from "./lib/usePlanTool";
import type { Place, Plan, SavedTrip, Survey, TripInput, SearchTrace } from "./types";

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "Europe/Paris",
  }).format(new Date(iso));
function initialPrefs() {
  try {
    return JSON.parse(
      localStorage.getItem("park-in-paris.preferences.v1") || "{}",
    );
  } catch {
    return {};
  }
}
export default function App() {
  const { trips, saveTrips, status: syncStatus, error: syncError, sync } = useTripStore();
  const [origin, setOrigin] = useState<Place | null>(MONTREUIL),
    [destination, setDestination] = useState<Place | null>(GARNIER),
    [times, setTimes] = useState(defaultTimes),
    [prefs] = useState(initialPrefs),
    [maxWalk, setMaxWalk] = useState<number>(Number(prefs.maxWalk) || 30),
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
  const abortRef = useRef<AbortController | null>(null),
    reduceMotion = useReducedMotion();
  const active = trips.find((t) => t.status === "active"),
    surveyTrip = trips.find((t) => t.id === surveyId),
    candidate = plan?.candidates[selected],
    summary = candidate ? circuitSummary(candidate) : undefined,
    focusedStreet = candidate?.searchRoute?.stops[selectedStop] ?? candidate;
  const revealMap = useCallback(() => {
    if (innerWidth <= 760) window.scrollTo({ top: 0, behavior: reduceMotion ? "instant" : "smooth" });
  }, [reduceMotion]);
  const selectCandidate = useCallback((index: number) => {
    setSelected(index); setSelectedStop(0); setFocusMode("circuit"); setFocusRequest(n => n + 1); revealMap();
  }, [revealMap]);
  const selectStop = useCallback((index: number) => {
    setSelectedStop(index); setFocusMode("street"); setFocusRequest(n => n + 1); revealMap();
  }, [revealMap]);
  usePlanTool(tab === "results" ? plan : null);
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
    const update = () => setClock(Date.now()),
      timer = setInterval(update, 15000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
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
    if (innerWidth <= 760) window.scrollTo({ top: 0, behavior: reduceMotion ? "instant" : "smooth" });
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
      setToast("Experience saved. Thank you for making the next trip better.");
    }
  }
  const due = active && parseParis(active.input.returnAt).getTime() <= clock;
  return (
    <main className={`app ${tab === "results" ? "has-results" : ""}`}>
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
      <header className="topbar">
        <a
          className="brand"
          href={import.meta.env.BASE_URL}
          onClick={(e) => {
            e.preventDefault();
            if (!searching) setTab("plan");
          }}
        >
          <span className="brand-icon">
            P<span>↗</span>
          </span>
          <span>
            park in paris
            <span className="brand-caption">
              A LITTLE WALK. A BETTER ARRIVAL.
            </span>
          </span>
        </a>
        <span className="edition">
          PARIS, FRANCE <span>48.8566° N · 2.3522° E</span>
        </span>
        <button className="history-button" onClick={() => setShowHistory(true)}>
          <Clock3 size={17} />
          Your trips
          {trips.length ? (
            <span className="count-badge">{trips.length}</span>
          ) : null}
        </button>
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
      <AnimatePresence mode="wait">
        <motion.section
          className="planner"
          key={tab}
          initial={reduceMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? undefined : { opacity: 0, y: -8 }}
          transition={{ duration: 0.25 }}
        >
          {tab === "plan" ? (
            <form onSubmit={search}>
              <div className="eyebrow">
                <span className="small-dot" />
                PARIS STREET PARKING
              </div>
              <h1>Where to?</h1>
              <p className="intro">
                Find your parking circuit.
                <br />
                Make the rest a Parisian walk.
              </p>
              <PlaceInput
                label="STARTING FROM"
                value={origin}
                onChange={setOrigin}
                origin
                disabled={searching}
              />
              <PlaceInput
                label="YOUR DESTINATION"
                value={destination}
                onChange={setDestination}
                disabled={searching}
              />
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
              <span className="timezone-note">All times are Paris time.</span>
              <div className="walk-label">
                <label htmlFor="max-walk">
                  <Footprints size={18} /> A little room to walk
                </label>
                <strong>
                  {maxWalk} <small>min max</small>
                </strong>
              </div>
              <input
                id="max-walk"
                className="walk-slider"
                type="range"
                min="5"
                max="30"
                step="5"
                value={maxWalk}
                onChange={(e) => setMaxWalk(Number(e.target.value))}
                disabled={searching}
              />
              <div className="range-labels">
                <span>5 MIN</span>
                <span>30 MIN</span>
              </div>
              <button
                type="button"
                className="preferences-toggle"
                onClick={() => setShowSettings(!showSettings)}
                aria-expanded={showSettings}
              >
                <SlidersHorizontal size={14} />
                Planning preferences <span>{showSettings ? "−" : "+"}</span>
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
                    <span>Finding your best arrival</span>
                    <LoaderCircle size={21} className="spin" />
                  </>
                ) : (
                  <>
                    Find my parking <ArrowUpRight size={21} />
                  </>
                )}
              </button>
              {searching ? (
                <button
                  className="text-button cancel-search"
                  type="button"
                  onClick={cancel}
                >
                  Cancel search
                </button>
              ) : (
                <div className="planner-note">
                  <Route size={16} />
                  <span>More spaces. A short circuit. A little walk.</span>
                </div>
              )}
              <div className="source-note">
                <span>OPEN CITY DATA</span>
                <button type="button" onClick={() => setShowInfo(true)}>
                  How estimates work <Info size={13} />
                </button>
              </div>
            </form>
          ) : plan && candidate ? (
            <>
              <button className="back-button" onClick={() => setTab("plan")}>
                <ArrowLeft size={16} />
                Adjust your trip
              </button>
              <div className="eyebrow result-eyebrow">A FEW STREETS. MORE POSSIBILITIES.</div>
              <h1 className="result-title">
                Your way to a space.
              </h1>
              <p className="result-destination">
                <MapPin size={15} />
                {plan.input.destination.label.split(" · ")[0]}
              </p>
              <div className="estimate-label">
                <Info size={13} />
                Choose a circuit · explore every street on the map
              </div>
              <p className="circuit-results-note">Mapped spaces, a compact drive, and your walk — choose the balance that suits you.</p>
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
              {summary ? <div className="circuit-summary">
                <p><Car size={14} /><strong>{Math.ceil(candidate.driveMinutes)} min to the circuit</strong></p>
                <small>{Math.floor(summary.totalLow)}–{Math.ceil(summary.totalHigh)} min to your destination, including driving, searching and walking.</small>
                <small className="circuit-finish-note">Follow the streets in order. Stop as soon as you find a space — there’s no need to finish the circuit.</small>
              </div> : null}
              <div className="selected-detail">
                <span className="circuit-preview-label">STREET PREVIEW · SELECT A NUMBER ON THE MAP</span>
                <span><CircleParking size={14} />{focusedStreet?.street} · {focusedStreet?.parkingType === "paid" ? "paid parking" : focusedStreet?.parkingType === "mixed" ? "mixed parking" : "eligible free / shared bays"}</span>
                {focusedStreet?.sharedCapacity ? <span>{focusedStreet.sharedCapacity} shared delivery spaces eligible for this stay.</span> : null}
                {candidate.learnedFrom ? <span><Sparkles size={13} />Adjusted using {candidate.learnedFrom} similar first-street visits.</span> : null}
              </div>
              <RouteNavigation key={`${candidate.circuit?.strategy ?? "legacy"}:${candidate.searchRoute?.stops.map(stop => stop.id).join(">") ?? candidate.id}`} candidate={candidate} origin={plan.input.origin.coordinates} />
              <a className="street-view-link" href={streetViewURL(focusedStreet!.coordinates)} target="_blank" rel="noopener noreferrer">
                <ScanEye size={18} /> Preview {focusedStreet?.street} in Street View <ArrowUpRight size={16} />
              </a>
              <button
                className="primary-button"
                onClick={startTrip}
                disabled={!!active}
              >
                {active ? "Trip in progress" : "Use this circuit"}
                <ArrowUpRight size={20} />
              </button>
              <a
                className="walk-link"
                href={navigationURL(
                  "google",
                  plan.input.destination.coordinates,
                  focusedStreet!.coordinates,
                  true,
                )}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Footprints size={14} />
                Walk from this street to your destination <ArrowRight size={13} />
              </a>
              <p className="result-caveat">
                Spaces are mapped, not confirmed empty. Check street signs when
                you park.
              </p>
              <div className="source-note">
                <span>{plan.compared} AREAS COMPARED</span>
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
        </motion.section>
      </AnimatePresence>
      <AnimatePresence>
        {searching ? (
          <motion.div
            className="search-display"
            role="status"
            aria-live="polite"
            initial={reduceMotion ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -6 }}
          >
            <div className="search-heading"><span className="search-sigil" aria-hidden="true"><Route size={20} /></span><span className="eyebrow">A LITTLE EXPLORING</span><span className="search-percent" aria-hidden="true">{progress}%</span></div>
            <h2>Finding your way to a space.</h2>
            <p>{stage}</p>
            <div className="search-progress" role="progressbar" aria-label="Parking search progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
              <span style={{ width: `${Math.max(5, progress)}%` }} />
            </div>
            <div className="search-phases" aria-hidden="true"><span className={progress >= 6 ? "reached" : ""}>Map spaces</span><span className={progress >= 30 ? "reached" : ""}>Connect streets</span><span className={progress >= 88 ? "reached" : ""}>Compare circuits</span></div>
            <small>Following real roads. Keeping your walk in reach.</small>
          </motion.div>
        ) : null}
      </AnimatePresence>
      {!searching ? (
        <div className="map-caption">
          <span className="map-caption-icon">
            {candidate && tab === "results" ? (
              <Route size={19} />
            ) : (
              <MapPin size={19} />
            )}
          </span>
          <div>
            <strong>
              {candidate && tab === "results"
                ? candidate.circuit ? CIRCUIT_LABELS[candidate.circuit.strategy] : "Explore your parking circuit"
                : "A city of possibilities."}
            </strong>
            <span>
              {candidate && tab === "results"
                ? `${summary?.capacity} mapped spaces · ${walkingRange(summary!.walkMin, summary!.walkMax)} min walk · tap a street number to inspect`
                : "Pick a destination. We’ll take it from here."}
            </span>
          </div>
        </div>
      ) : null}
      {showInfo ? (
        <Modal title="A little clarity." onClose={() => setShowInfo(false)}>
          <div className="info-copy">
            <p>
              <strong>Compare whole circuits.</strong> We look for more distinct
              eligible spaces along short driving routes, close to your
              destination. A parking section counts once, even if streets overlap.
              Every counted section stays within your walking limit. More mapped
              spaces give you more places to check; they do not tell us how many
              are empty.
            </p>
            <p>
              <strong>Three ways to arrive.</strong> Golden balance weighs mapped
              spaces, driving distance and walking together. Closest walk puts
              proximity first; more parking options favours greater mapped supply.
              We show fewer choices when the alternatives are too similar.
              These are planning tradeoffs, not measured odds or safety ratings.
            </p>
            <p>
              <strong>Open routing.</strong> Driving and walking routes come
              from IGN’s BD TOPO / OSRM service. When enabled, a simple 10–35%
              time-of-day allowance is added to driving. This is a planning
              assumption, not live or measured historical traffic.
            </p>
            <p>
              <strong>Drive until you find a space.</strong> The circuit gives you
              up to four streets in driving order, with short connections between
              them. You can stop on any street; you do not need to complete a loop.
              The total time range covers finding a space early or continuing
              along the circuit, then walking. It is a scenario range, not a
              guaranteed arrival time.
            </p>
            <p>
              <strong>A useful route, with nearby spaces.</strong> Circuit distance
              measures the connections between street stopping points. Counted
              parking sections can lie nearby along those streets; the route does
              not promise to pass every individual space.
            </p>
            <p>
              <strong>An early parking model.</strong> Search scenarios use
              eligible capacity, district and time of day. They are uncalibrated
              assumptions, not probabilities or confidence intervals. Three or
              more similar successful trips allow a small personal adjustment;
              abandoned attempts are saved separately for future modelling.
            </p>
            <p>
              <strong>Rules first.</strong> Shared livraison bays count only
              when permitted for the whole stay. Permanent delivery bays, custom
              hours, markets and the two Bois are excluded. Paid visitor stays
              over six hours are excluded. Temporary works and street-sign
              changes may be missing.
            </p>
            <p>
              <strong>Walking is routed.</strong> Times use IGN’s walking pace.
              Your final walk can vary with the exact space you find.
            </p>
            <p>
              <strong>Private, server-saved history.</strong> Trips and feedback
              sync to our database using a private browser identifier, with no
              login. A local copy keeps changes safe while offline. Clearing
              cookies loses access to this history; export before changing
              browsers. Reminders appear when you return to the app.
            </p>
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
              {plan ? (
                <span>
                  Inventory imported {formatDate(plan.inventoryDate)} ·{" "}
                  {plan.modelVersion}
                </span>
              ) : null}
            </div>
          </div>
        </Modal>
      ) : null}
      {showHistory ? (
        <Modal
          title="Your little journeys."
          onClose={() => setShowHistory(false)}
        >
          <div className={`sync-status ${syncStatus}`} role="status">
            {syncStatus === "saved" ? <CheckCircle2 size={16} /> : syncStatus === "syncing" ? <LoaderCircle size={16} className="spin" /> : <Info size={16} />}
            <span>{syncStatus === "saved" ? "Saved privately on the server" : syncStatus === "syncing" ? "Syncing your history…" : "Saved on this device · sync pending"}</span>
            {syncStatus === "offline" ? <button onClick={() => void sync()}>Retry</button> : null}
          </div>
          {syncError ? <p className="field-error">{syncError}</p> : null}
          {trips.length ? (
            <>
              <p className="history-intro">
                Your plans and experiences. No login; linked to this browser.
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
              <h3>Your next trip starts here.</h3>
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
      <AnimatePresence>
        {toast ? (
          <motion.div
            className="toast"
            role="status"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
          >
            <CheckCircle2 size={18} />
            {toast}
            <button
              className="icon-button"
              aria-label="Dismiss notification"
              onClick={() => setToast("")}
            >
              <X size={16} />
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </main>
  );
}
