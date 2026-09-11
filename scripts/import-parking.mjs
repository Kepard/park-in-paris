import { mkdir, writeFile } from "node:fs/promises";
const source =
  "https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/stationnement-sur-voie-publique-emprises";
const params = new URLSearchParams({
  where: "regpar IN ('Mixte','Rotatif','Gratuit','ZL périodique')",
  select:
    "id,regpar,plarel,placal,typevoie,nomvoie,arrond,geo_point_2d,plage_hor1_debut,plage_hor1_fin,plage_hor2_debut,plage_hor2_fin,plage_hor3_debut,plage_hor3_fin",
  limit: "-1",
});
const response = await fetch(`${source}/exports/json?${params}`, {
  signal: AbortSignal.timeout(120000),
});
if (!response.ok) throw new Error(`Paris dataset HTTP ${response.status}`);
const rows = await response.json();
const bays = rows.flatMap((r, index) => {
  const p = r.geo_point_2d;
  if (!p) return [];
  // Conservative woodland exclusion: includes a small boundary margin.
  if (
    (p.lon < 2.277 && p.lat < 48.885 && p.lat > 48.831) ||
    (p.lon > 2.402 && p.lat < 48.846)
  )
    return [];
  const capacity =
    Number.isFinite(r.plarel) && r.plarel >= 0 ? r.plarel : r.placal;
  if (!Number.isFinite(capacity) || capacity <= 0) return [];
  const street = `${r.typevoie || ""} ${r.nomvoie || ""}`
    .trim()
    .toLocaleLowerCase("fr")
    .replace(/(^|[\s-])\p{L}/gu, (x) => x.toLocaleUpperCase("fr"));
  return [
    {
      id: `${r.id || "row"}-${index}`,
      street,
      arrondissement: Number(r.arrond),
      coordinates: [Number(p.lon.toFixed(6)), Number(p.lat.toFixed(6))],
      capacity,
      kind:
        r.regpar === "ZL périodique"
          ? "shared"
          : r.regpar === "Gratuit"
            ? "free"
            : "paid",
      customHours: [1, 2, 3].some(
        (i) =>
          r[`plage_hor${i}_debut`] != null || r[`plage_hor${i}_fin`] != null,
      ),
    },
  ];
});
if (bays.length < 1000)
  throw new Error(
    "Inventory unexpectedly small; preserving previous snapshot.",
  );
await mkdir("public/data", { recursive: true });
await writeFile(
  "public/data/parking.json",
  JSON.stringify({
    updated: new Date().toISOString(),
    source:
      "https://opendata.paris.fr/explore/dataset/stationnement-sur-voie-publique-emprises/",
    license: "ODbL-1.0",
    bays,
  }),
);
console.log(
  `Imported ${bays.length} parking sections from ${rows.length} records.`,
);
