# Park in Paris

A small, animated street-parking planner. Compare driving, estimated searching and walking time; save a plan, open it in Waze or Google Maps, and record how parking went.

Designed for https://kepard.dev/projects/park-in-paris/ and deployed on Vercel.

## Run

Node 24 recommended. `npm install`, then `npm run dev`. For server history, pull the linked Vercel project's development environment to `.env.local`, run `npm run db:setup`, then `npm run dev:api` in a second terminal. Vite proxies the app's API path to that local server. `npm run build` typechecks and builds. `npm test` checks legal time windows, Paris timezone/DST, inventory, feedback and navigation links. `npm run test:server` tests the real dedicated database with isolated test identities.

## Data and cost

- Parking: [Ville de Paris, stationnement sur voie publique — emprises](https://opendata.paris.fr/explore/dataset/stationnement-sur-voie-publique-emprises/), ODbL 1.0. The derived inventory is in `public/data/parking.json`. Attribution and source are preserved. Regenerate with `npm run data:refresh`.
- Geocoding and car/pedestrian routes: [IGN Géoplateforme](https://cartes.gouv.fr/), using open reference data and the OSRM routing resource. Address lookup combines addresses and named places, biases toward Paris and restricts destinations to Paris. Origins can be in the suburbs. No API key. Route requests are serialized and paced at less than five per second, with a bounded in-memory route cache.
- Map rendering: MapLibre GL JS. Basemap: CARTO / OpenStreetMap, with visible attribution. The public basemap is suitable for this personal pilot; review provider terms before expanding usage.
- Trip storage uses a dedicated Neon `free_v3` database in Frankfurt with Vercel Functions. No paid map APIs or LLM calls. The configured free database has finite limits; this remains a personal pilot.
- Google Places autocomplete was not enabled: it requires billing and has map-display restrictions. [Google Maps URLs](https://developers.google.com/maps/documentation/urls/get-started) provide navigation and Street View without an API key. Street View opens nearby imagery when available; it is not a live view of parking occupancy.

## What the estimates mean

This is a transparent heuristic pilot, not a live vacancy detector. Inventory records can be stale or incomplete. Search ranges are optimistic/pessimistic scenarios from uncalibrated capacity, district and time-of-day assumptions, not probability or confidence intervals. The optional congestion allowance is a 10–35% time-of-day multiplier, not live traffic or measured historical traffic. Direct driving times alone are not comparable to a full drive/search/walk arrival.

Candidates are compact same-street groups with actual mapped anchors. Every counted parking section is checked against a routed pedestrian limit. Search-area access is routed by IGN, but temporary street restrictions may be missing. Walking can vary within an individual mapped section. Candidate search is a shortlist, not a proof of a global optimum. The three cards are independent alternatives; their totals do not include searching one then transferring to another.

Colored loading pulses follow the returned route geometries from origin toward each candidate and destination. They illustrate the alternatives being compared; they do not expose the routing engine's internal graph traversal. Reduced-motion preferences render static colored paths.

Shared delivery bays count only when legal throughout the planned stay. Unknown/custom hours, permanent delivery, market and reserved categories are excluded. Woodland areas and a conservative boundary margin are excluded. Paid visitor stays over six hours are excluded. Rules use Europe/Paris and metropolitan French public holidays. Street signs take precedence.

The model stores the original prediction and version with each trip. Personal adjustment starts only after three successful observations on the same street within 200 metres, within two hours, and in the same weekday/Saturday/Sunday-or-holiday class. Unsupported space types are excluded. The adjustment is shrunk toward the baseline. Abandoned and elsewhere attempts remain in the export for later censored-outcome modelling; they are not incorrectly averaged as successful search durations. This success-only adjustment can still be optimistic and is optional.

## Trip survey

Choose **Use this parking plan** to start a trip. Finish it explicitly, or reopen the app after the expected return time to see the survey. The app does not track background movement, infer that parking succeeded, or send background notifications. The survey captures outcome, search minutes, streets tried, actual search time, bay type and optional notes.

## Private server history

No login is needed. A 256-bit random identifier in a Secure, HttpOnly, SameSite cookie identifies this browser; the database stores its SHA-256 hash, never the cookie secret. All reads and writes are scoped to that identity, with no public listing. The cookie is restricted to the app path and renewed when used. Server responses are private and never cached.

Existing local trips migrate automatically. The newest 100 trips and feedback are retained; a local cache and persistent outbox support offline changes and retries on reconnect, focus or manual retry. Supported browsers serialize synchronization across tabs with Web Locks. If the cookie is replaced but local records survive, those records are restored into the new private history. There is no account-based cross-device access; export before clearing all browser data or changing devices.

Deletion removes trip content from the database and local cache. A minimal identifier-only deletion marker prevents a delayed upload from recreating the content. Old active-trip writes cannot overwrite completed feedback. Database setup is explicit and idempotent; it is not run on each request.

## Hosting under the domain path

Vite's base is `/projects/park-in-paris/`. This app's `vercel.json` maps prefixed assets and data to the build output. The existing `kepard-home` Vercel project proxies only `/projects/park-in-paris` and its descendants to this project's deployment, preserving the prefix. Cloudflare DNS remains unchanged.

No secrets belong in this repository. No account or credential is needed to use the app.

## Optional browser tool

Feature-detected WebMCP exposes `read_parking_recommendations`, a read-only view of the current results. Normal browsing needs no WebMCP support. Registration, empty-state and populated-result reads, and rejection of invalid input were verified in a compatible browser alongside the standard UI.
