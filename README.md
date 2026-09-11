# Park in Paris

A small, animated street-parking planner. Compare driving, estimated searching and walking time; save a plan, open it in Waze or Google Maps, and record how parking went.

Designed for https://kepard.dev/projects/park-in-paris/ and deployed on Vercel.

## Run

Node 24 recommended. `npm install`, then `npm run dev`. Open the URL printed by Vite. `npm run build` typechecks and builds. `npm test` checks legal time windows, Paris timezone/DST, feedback and navigation links.

## Data and cost

- Parking: [Ville de Paris, stationnement sur voie publique — emprises](https://opendata.paris.fr/explore/dataset/stationnement-sur-voie-publique-emprises/), ODbL 1.0. The derived inventory is in `public/data/parking.json`. Attribution and source are preserved. Regenerate with `npm run data:refresh`.
- Geocoding and car/pedestrian routes: [IGN Géoplateforme](https://cartes.gouv.fr/), using open reference data and the OSRM routing resource. No API key. Requests are serialized and paced at less than five per second, with a bounded in-memory route cache.
- Map rendering: MapLibre GL JS. Basemap: CARTO / OpenStreetMap, with visible attribution. The public basemap is suitable for this personal pilot; review provider terms before expanding usage.
- No paid APIs, database or LLM calls. Preferences and up to 100 trip records are stored locally in the browser. Export JSON before clearing browser storage or changing devices.

## What the estimates mean

This is a transparent heuristic pilot, not a live vacancy detector. Inventory records can be stale or incomplete. Search ranges are optimistic/pessimistic scenarios from uncalibrated capacity, district and time-of-day assumptions, not probability or confidence intervals. The optional congestion allowance is a 10–35% time-of-day multiplier, not live traffic or measured historical traffic. Direct driving times alone are not comparable to a full drive/search/walk arrival.

Candidates are compact same-street groups with actual mapped anchors. Every counted parking section is checked against a routed pedestrian limit. Search-area access is routed by IGN, but temporary street restrictions may be missing. Walking can vary within an individual mapped section. Candidate search is a shortlist, not a proof of a global optimum. The three cards are independent alternatives; their totals do not include searching one then transferring to another.

Shared delivery bays count only when legal throughout the planned stay. Unknown/custom hours, permanent delivery, market and reserved categories are excluded. Woodland areas and a conservative boundary margin are excluded. Paid visitor stays over six hours are excluded. Rules use Europe/Paris and metropolitan French public holidays. Street signs take precedence.

The model stores the original prediction and version with each trip. Personal adjustment starts only after three successful observations on the same street within 200 metres, within two hours, and in the same weekday/Saturday/Sunday-or-holiday class. Unsupported space types are excluded. The adjustment is shrunk toward the baseline. Abandoned and elsewhere attempts remain in the export for later censored-outcome modelling; they are not incorrectly averaged as successful search durations. This success-only adjustment can still be optimistic and is optional.

## Trip survey

Choose **Use this parking plan** to start a trip. Finish it explicitly, or reopen the app after the expected return time to see the survey. The app does not track background movement, infer that parking succeeded, or send background notifications. The survey captures outcome, search minutes, streets tried, actual search time, bay type and optional notes.

## Hosting under the domain path

Vite's base is `/projects/park-in-paris/`. This app's `vercel.json` maps prefixed assets and data to the build output. The existing `kepard-home` Vercel project proxies only `/projects/park-in-paris` and its descendants to this project's deployment, preserving the prefix. Cloudflare DNS remains unchanged.

No secrets belong in this repository. No account or credential is needed to use the app.

## Optional browser tool

Feature-detected WebMCP exposes `read_parking_recommendations`, a read-only view of the current results. Normal browsing needs no WebMCP support. Registration, empty-state and populated-result reads, and rejection of invalid input were verified in a compatible browser alongside the standard UI.
