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
