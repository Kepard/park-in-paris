export type Coordinate = [number, number];
export type Place = {
  label: string;
  coordinates: Coordinate;
  postcode?: string;
};
export type Bay = {
  id: string;
  street: string;
  arrondissement: number;
  coordinates: Coordinate;
  capacity: number;
  kind: "paid" | "free" | "shared";
  customHours: boolean;
};
export type Inventory = {
  updated: string;
  source: string;
  license: string;
  bays: Bay[];
};
export type TripInput = {
  origin: Place;
  destination: Place;
  departure: string;
  returnAt: string;
  maxWalk: number;
  rushAllowance: boolean;
  useExperience: boolean;
};
export type RouteData = {
  duration: number;
  distance: number;
  geometry: { type: "LineString"; coordinates: Coordinate[] };
};
export type SearchTrace = { id: string; geometry: RouteData["geometry"] };
export type SearchStop = {
  id: string;
  street: string;
  arrondissement: number;
  coordinates: Coordinate;
  bays: Bay[];
  capacity: number;
  sharedCapacity: number;
  walk: RouteData;
  walkMinutes: number;
  parkingType: "paid" | "free" | "mixed";
  /** Directed car route from the previous stop; absent on the first street. */
  driveFromPrevious?: RouteData;
  arrivalLow: string;
  arrivalHigh: string;
  totalLow: number;
  totalHigh: number;
};
export type SearchRoute = {
  stops: SearchStop[];
  capacity: number;
  extraDriveMinutes: number;
  /** Scenario range, not a confidence interval or a guarantee of a space. */
  totalLow: number;
  totalHigh: number;
};
export type CircuitStrategy = "balanced" | "closest" | "more-spaces";
export type Candidate = {
  id: string;
  street: string;
  arrondissement: number;
  coordinates: Coordinate;
  bays: Bay[];
  capacity: number;
  sharedCapacity: number;
  drive: RouteData;
  walk: RouteData;
  driveMinutes: number;
  walkMinutes: number;
  searchLow: number;
  searchHigh: number;
  totalLow: number;
  totalHigh: number;
  total: number;
  arrival: string;
  learnedFrom: number;
  reason: string;
  parkingType: "paid" | "free" | "mixed";
  searchRoute?: SearchRoute;
  /** Optional so server-saved street plans from earlier versions remain readable. */
  circuit?: { strategy: CircuitStrategy };
};
export type Plan = {
  input: TripInput;
  candidates: Candidate[];
  directDrive: number | null;
  inventoryDate: string;
  compared: number;
  modelVersion: string;
  warnings: string[];
};
export type Survey = {
  outcome: "here" | "elsewhere" | "gave-up";
  searchMinutes: number;
  streetsTried: number;
  bayType: "ordinary" | "delivery" | "other";
  note: string;
  submittedAt: string;
  actualStreet: string;
  observedArrival: string;
  parkedStopId?: string;
};
export type SavedTrip = {
  id: string;
  createdAt: string;
  status: "active" | "completed";
  input: TripInput;
  candidate: Candidate;
  modelVersion: string;
  survey?: Survey;
  completedAt?: string;
};
