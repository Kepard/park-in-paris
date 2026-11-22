import type { Bay, Inventory } from "../src/types.js";

const dataset = "stationnement-sur-voie-publique-emprises";
const source = `https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/${dataset}`;
const uses: Record<string, string> = {
  "PAYANT MIXTE": "Mixte", "PAYANT ROTATIF": "Rotatif", GRATUIT: "Gratuit", LIVRAISON: "ZL périodique",
};
const where = Object.entries(uses).map(([regime, use]) =>
  `(regpri='${regime}' AND regpar='${use}')`).join(" OR ");
const hours = [1, 2, 3].flatMap(i => [`plage_hor${i}_debut`, `plage_hor${i}_fin`]);
const select = ["id", "id_old", "regpri", "regpar", "plarel", "placal", "typevoie", "nomvoie", "arrond", "geo_point_2d", ...hours].join(",");

type CityRow = {
  id: string | null; id_old: string | null; regpri: string; regpar: string;
  plarel: number | null; placal: number | null; typevoie: string | null; nomvoie: string | null;
  arrond: number; geo_point_2d: { lon: number; lat: number } | null; [key: string]: unknown;
};
type SourceBay = Bay & { sourceRegime: string; sourceUse: string };

async function readCity<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Paris data HTTP ${response.status}`);
  return response.json();
}

export function parkingSections(rows: CityRow[]): SourceBay[] {
  const ids = new Set<string>();
  const bays: SourceBay[] = [];
  for (const row of rows) {
    // Paris uses districts 21 and 22 for the two Bois.
    const arrondissement = Number(row.arrond);
    const point = row.geo_point_2d;
    if (!Object.hasOwn(uses, row.regpri) || uses[row.regpri] !== row.regpar ||
        !Number.isInteger(arrondissement) || arrondissement < 1 || arrondissement > 20 ||
        !row.nomvoie || !point || !Number.isFinite(point.lon) || !Number.isFinite(point.lat)) continue;
    const capacity = row.plarel !== null && Number.isFinite(row.plarel) && row.plarel >= 0 ? row.plarel : row.placal;
    if (capacity === null || !Number.isFinite(capacity) || capacity <= 0) continue;
    const id = row.id ? `paris-${row.id}` : row.id_old ? `legacy-${row.id_old}` : null;
    if (!id || ids.has(id)) throw new Error("Missing or duplicate Paris section identifier.");
    ids.add(id);
    const street = `${row.typevoie || ""} ${row.nomvoie}`.trim().toLocaleLowerCase("fr")
      .replace(/(^|[\s-])\p{L}/gu, letter => letter.toLocaleUpperCase("fr"));
    const kind = row.regpri === "LIVRAISON" ? "shared" : row.regpri === "GRATUIT" ? "free" : "paid";
    bays.push({
      id, street, arrondissement, coordinates: [Number(point.lon.toFixed(6)), Number(point.lat.toFixed(6))],
      capacity, kind, customHours: hours.some(key => row[key] != null),
      sourceRegime: row.regpri, sourceUse: row.regpar,
    });
  }
  return bays.sort((a, b) => a.id < b.id ? -1 : 1);
}

export async function readParisInventory(signal: AbortSignal): Promise<Inventory> {
  const [metadata, count, rows] = await Promise.all([
    readCity<{metas: {default: {data_processed: string}}}>(source, signal),
    readCity<{total_count: number}>(`${source}/records?${new URLSearchParams({ where, limit: "0" })}`, signal),
    readCity<CityRow[]>(`${source}/exports/json?${new URLSearchParams({ where, select, limit: "-1" })}`, signal),
  ]);
  if (!Array.isArray(rows) || rows.length !== count.total_count)
    throw new Error("Incomplete Paris data export.");
  const updated = new Date(Date.parse(metadata.metas.default.data_processed)).toISOString();
  const bays = parkingSections(rows);
  if (bays.length < 1000) throw new Error("Unexpectedly small parking inventory.");
  return { updated, source: `https://opendata.paris.fr/explore/dataset/${dataset}/`, license: "ODbL-1.0", bays };
}
