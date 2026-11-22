import {
  ArrowUpRight,
  Footprints,
  MapPin,
  Route,
  Clock3,
  ChevronUp,
  Maximize2,
  Pencil,
  PanelBottomOpen,
  Check,
  ArrowRight,
  CircleParking,
  LoaderCircle,
  X,
  Info,
  ExternalLink,
  Download,
  Trash2,
  SlidersHorizontal,
  CheckCircle2,
  ScanEye,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, useDragControls } from "motion/react";
import * as m from "motion/react-m";
import { phone, useMediaQuery, useSheetInset } from "./lib/useViewport";
import { ScheduleControl, WalkControl } from "./components/TripControls";
import { SearchPanel } from "./components/SearchPanel";
import { PlaceInput } from "./components/PlaceInput";
import { Modal } from "./components/Modal";
import { SurveyForm } from "./components/SurveyForm";
import { RouteNavigation } from "./components/RouteNavigation";
import { CircuitChoices } from "./components/CircuitCard";
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
    [showDirections, setShowDirections] = useState(false),
    [mapExpanded, setMapExpanded] = useState(false),
    [surveyId, setSurveyId] = useState<string | null>(null),
    [toast, setToast] = useState(""),
    [reminderDismissed, setReminderDismissed] = useState<string | null>(null),
    [clock, setClock] = useState(Date.now());
  const abortRef = useRef<AbortController | null>(null);
  const sheet = useRef<HTMLElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const searchError = useRef<HTMLParagraphElement>(null);
  const sheetDrag = useDragControls();
  const draggedHandle = useRef(false);
  const mobile = useMediaQuery(phone);
  const inset = useSheetInset(sheet, mobile);
  const mode = searching ? "search" : mobile && mapExpanded ? "map" : tab;
  const editMode = mode === "plan" || mode === "results";
  const previousMode = useRef(mode);
  const mapOpener = useRef<HTMLElement | null>(null);
  const active = trips.find((t) => t.status === "active"),
    surveyTrip = trips.find((t) => t.id === surveyId),
    candidate = tab === "results" ? plan?.candidates[selected] : undefined,
    summary = candidate ? circuitSummary(candidate) : undefined,
    focusedStreet = candidate?.searchRoute?.stops[selectedStop] ?? candidate;
  const openMap = useCallback(() => {
    if (!phone.matches || mapExpanded) return;
    if (document.activeElement instanceof HTMLElement) mapOpener.current = document.activeElement;
    setMapExpanded(true);
  }, [mapExpanded]);
  function startSheetDrag(event: React.PointerEvent) {
    draggedHandle.current = false;
    sheetDrag.start(event);
  }
  const selectCandidate = useCallback((index: number) => {
    setSelected(index); setSelectedStop(0); setFocusMode("circuit"); setFocusRequest(n => n + 1);
  }, []);
  const selectStop = useCallback((index: number) => {
    setSelectedStop(index); setFocusMode("street"); setFocusRequest(n => n + 1);
    openMap();
  }, [openMap]);
  usePlanTool(tab === "results" ? plan : null);
  useEffect(() => {
    const before = previousMode.current;
    previousMode.current = mode;
    if (mode === before) return;
    const opener = mapOpener.current;
    if (before === "map" && opener?.isConnected && opener.getClientRects().length) {
      opener.focus({ preventScroll: true });
    } else {
      sheet.current?.querySelector<HTMLElement>("[data-panel-focus]:not([hidden] *)")?.focus({ preventScroll: true });
    }
    if (before !== "map" && editMode) scroller.current?.scrollTo(0, 0);
  }, [mode, editMode]);
  useEffect(() => {
    if (error && mode === "plan") searchError.current?.focus();
  }, [error, mode]);
  useEffect(() => {
    if (mode !== "map") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("dialog[open]")) setMapExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode]);
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
    setMapExpanded(false);
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
      setShowDirections(true);
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
      setShowDirections(true);
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
  const inspectedStreet = tab === "results" && focusMode === "street" ? focusedStreet : undefined;
  return (
    <main className={`app mode-${mode}`} style={{ "--sheet-inset": `${inset}px` } as React.CSSProperties}>
      <a className="skip-link" href="#trip-planner">Skip to planner</a>
      <header className="topbar">
        <a
          className="brand"
          href={import.meta.env.BASE_URL}
          onClick={(e) => {
            e.preventDefault();
            if (!searching) { setMapExpanded(false); setTab("plan"); }
          }}
        >
          <img className="brand-icon" src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width="35" height="35" />
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
            sheetInset={inset}
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
        {mobile && editMode && <button className="expand-map" type="button" onClick={openMap}>
          <Maximize2 size={15} /> Full map
        </button>}
      </section>
      <m.section ref={sheet} layout={mobile ? "position" : false} layoutDependency={mode}
        drag={mobile && mode !== "search" ? "y" : false} dragControls={sheetDrag} dragListener={false}
        dragConstraints={{ top: 0, bottom: 0 }} dragMomentum={false}
        dragElastic={mode === "map" ? { top: 0.5, bottom: 0 } : { top: 0, bottom: 0.5 }}
        onDragEnd={(_, { offset }) => {
          draggedHandle.current = true;
          if (mode === "map" && offset.y < -30) setMapExpanded(false);
          else if (editMode && offset.y > 30) openMap();
        }}
        className="planner" id="trip-planner" aria-label="Parking planner" tabIndex={-1}>
        {mode === "search" && <SearchPanel stage={stage} progress={progress} cancel={cancel} />}
        {mode === "map" && <div className="map-dock">
          <button className="return-to-panel" type="button" data-panel-focus onPointerDown={startSheetDrag}
            onClick={e => { if (!e.detail || !draggedHandle.current) setMapExpanded(false); }}>
            <span className="dock-icon"><PanelBottomOpen size={21} /></span>
            <span><strong>{inspectedStreet?.street ?? (tab === "results" ? "Show circuits" : "Show trip planner")}</strong>
              <small>{inspectedStreet
                ? `${inspectedStreet.capacity} mapped spaces · Show circuits`
                : destination?.label.split(" · ")[0] ?? "Choose a destination"}</small></span>
            <ChevronUp size={17} />
          </button>
          {inspectedStreet &&
            <a className="dock-street-view" href={streetViewURL(inspectedStreet.coordinates)}
              target="_blank" rel="noopener noreferrer" aria-label={`Street View on ${inspectedStreet.street}`}><ScanEye size={21} /><span>Street View</span></a>}
        </div>}
        {mobile && editMode && <button className="sheet-handle" type="button" aria-label="Expand parking map"
          onPointerDown={startSheetDrag} onClick={e => { if (!e.detail || !draggedHandle.current) openMap(); }}><span /></button>}
        <div ref={scroller} className="panel-scroll" hidden={!editMode}>
        {tab === "plan" ? (
          <form id="trip-form" key="plan" onSubmit={search} noValidate>
            <div className="panel-heading">
              <h1 tabIndex={-1} data-panel-focus>Plan your trip</h1>
              <button type="button" className="panel-tool" title="Parking preferences" aria-label="Parking preferences"
                aria-haspopup="dialog" onClick={() => setShowSettings(true)}><SlidersHorizontal size={18} /></button>
            </div>
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
            <ScheduleControl times={times} onChange={setTimes} />
            <WalkControl value={maxWalk} onChange={setMaxWalk} />
            {error ? (
              <p ref={searchError} className="error-message" role="alert" tabIndex={-1}>
                {error}
              </p>
            ) : null}
          </form>
        ) : plan && candidate ? (
          <m.div key="results" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <div className="panel-heading">
              <div><h1 tabIndex={-1} data-panel-focus>Your circuits</h1>
                <p className="result-destination"><MapPin size={14} />{plan.input.destination.label.split(" · ")[0]}</p></div>
              <button className="panel-tool" aria-label="Adjust your trip" title="Adjust your trip" onClick={() => setTab("plan")}><Pencil size={17} /></button>
            </div>
            <CircuitChoices candidates={plan.candidates} selected={selected} onSelect={selectCandidate} />
            {summary && <div className="circuit-summary">
              <span>Estimated time to destination</span>
              <strong>{Math.floor(summary.totalLow)}–{Math.ceil(summary.totalHigh)} <small>min</small></strong>
              <p>{Math.ceil(candidate.driveMinutes)} min drive to the first street, then search and walk.</p>
            </div>}
            <RouteNavigation key={candidate.id + ":" + selected} candidate={candidate} origin={plan.input.origin.coordinates} />
            <div className="street-preview">
              <h2>Streets in driving order</h2>
              <ol className="street-list">
                {(candidate.searchRoute?.stops ?? [candidate]).map((stop, index) =>
                  <li key={stop.id}><button onClick={() => selectStop(index)} aria-pressed={focusMode === "street" && index === selectedStop}>
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
          </m.div>
        ) : null}
        </div>
        <div className="planner-footer" hidden={!editMode}>
          {tab === "plan" ? <m.button type="submit" form="trip-form" className="primary-button action-button"
            key="find" whileTap={{ scale: 0.985 }}><span>Find parking circuits</span><span className="action-icon"><ArrowRight size={19} /></span></m.button>
          : <m.button type="button" className="primary-button action-button" onClick={startTrip}
            key="use" whileTap={{ scale: 0.985 }}><span>{active ? "Open active trip" : "Use this circuit"}</span><span className="action-icon"><ArrowRight size={19} /></span></m.button>}
        </div>
      </m.section>
      <AnimatePresence>
      {showSettings && <Modal key="preferences" title="Parking preferences" onClose={() => setShowSettings(false)}>
        <div className="preferences">
          <label><span>Typical congestion<small>Allow extra driving time during busy hours.</small></span>
            <input type="checkbox" checked={rushAllowance} onChange={e => setRushAllowance(e.target.checked)} /></label>
          <label><span>Learn from my trips<small>Adjust estimates after three similar successful trips.</small></span>
            <input type="checkbox" checked={useExperience} onChange={e => setUseExperience(e.target.checked)} /></label>
        </div>
        <button className="primary-button" onClick={() => setShowSettings(false)}>Done <Check size={18} /></button>
      </Modal>}
      {showDirections && active && <Modal key="directions" title="Driving directions" onClose={() => setShowDirections(false)}>
        <p className="direction-destination"><MapPin size={16} />{active.input.destination.label.split(" · ")[0]}</p>
        <p className="dialog-hint">Your circuit is saved. Start on {active.candidate.street}.</p>
        <RouteNavigation candidate={active.candidate} origin={active.input.origin.coordinates} />
      </Modal>}
      {showInfo ? (
        <Modal key="info" title="How estimates work" onClose={() => setShowInfo(false)}>
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
          key="history" title="Your trips"
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
      {toast && <m.div key="notice" className="toast" role="status" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <CheckCircle2 size={18} />
            {toast}
            <button
              className="icon-button"
              aria-label="Dismiss notification"
              onClick={() => setToast("")}
            >
              <X size={16} />
            </button>
      </m.div>}
      </AnimatePresence>
    </main>
  );
}
