# Park in Paris

A small, animated street-parking planner. Compare driving, estimated searching and walking time; save a plan, open it in Waze or Google Maps, and record how parking went.

Designed for https://parkinparis.kepard.dev/ and deployed on Vercel.

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

Candidates are compact same-street groups with actual mapped anchors. Every counted parking section is checked against a routed pedestrian limit. Search-area access is routed by IGN, but temporary street restrictions may be missing. Walking can vary within an individual mapped section. Candidate search is a shortlist, not a proof of a global optimum. The three cards are alternative starting streets. Each targets a short, ordered search route with three distinct backup streets. Nearby discovery gives each initial starting option up to four local candidates and, when a route remains incomplete, checks up to two more nearby streets. Bounded backtracking avoids committing to a high-capacity street that leaves no useful onward route; the three suggestions share a 48-request directed-route budget and cache. Backups use directed car routes, keep all counted sections within the walking limit, and are rechecked for parking eligibility at their sequential arrival times. A route can have fewer backups when nearby streets fail those checks. Each backup must offer at least six eligible mapped spaces and three spaces per added driving minute; legs are capped at four minutes and 1.2 km, with ten minutes and 2.4 km across the route. Backups add at most eight walking minutes relative to the first street, always within the user’s chosen walking limit. Among the shortlisted starts, a modest score preference for useful backups can outweigh up to six minutes of baseline estimated journey time; this ranking adjustment is never shown as travel time. Selecting a street zooms to its mapped sections; section labels show inventory capacity, not live empty spaces.

During street comparison the map zooms around the destination. Forest, sage and lime paths flow outward along returned route geometries, clipped to the local neighborhood. They illustrate the alternatives being compared; they do not expose the routing engine's internal graph traversal. Reduced-motion preferences render static colored paths.

Shared delivery bays count only when legal throughout the planned stay. Unknown/custom hours, permanent delivery, market and reserved categories are excluded. Woodland areas and a conservative boundary margin are excluded. Paid visitor stays over six hours are excluded. Rules use Europe/Paris and metropolitan French public holidays. Street signs take precedence.

The model stores the original prediction and version with each trip. For search routes, only a first-street success after trying one street can adjust that street’s model; a later-street success preserves its actual stop and whole-search time without misattributing it to the first street. Personal adjustment starts only after three successful observations on the same street within 200 metres, within two hours, and in the same weekday/Saturday/Sunday-or-holiday class. Unsupported space types are excluded. The adjustment is shrunk toward the baseline. Abandoned and elsewhere attempts remain in the export for later censored-outcome modelling; they are not incorrectly averaged as successful search durations. This success-only adjustment can still be optimistic and is optional.

## Opening a parking route

Google Maps receives the starting street followed by every backup, in order: all stops except the last are waypoints, and the final stop is the destination. A four-street plan uses three waypoints. This fits the three-waypoint mobile-browser limit. Previewing a different street does not change this full-route link. The walking destination remains a separate walking link. Google Maps recalculates directions between the supplied stops.

[Waze deep links](https://developers.google.com/waze/deeplinks) accept only a single destination. Its button opens a compact ordered list with a Waze link for the first street and each backup; users return to the app to open the next street when needed. Saved active trips offer the same navigation controls. Legacy trips without a search route keep single-street navigation.

## Trip survey

Choose **Use this parking plan** to start a trip. Finish it explicitly, or reopen the app after the expected return time to see the survey. The app does not track background movement, infer that parking succeeded, or send background notifications. The survey captures outcome, the actual suggested street when applicable, search minutes, streets tried, actual search time, bay type and optional notes. Saved plans preserve the ordered backups and their navigation links.

## Private server history

No login is needed. A 256-bit random identifier in a Secure, HttpOnly, SameSite cookie identifies this browser; the database stores its SHA-256 hash, never the cookie secret. All reads and writes are scoped to that identity, with no public listing. The cookie is host-only on the app subdomain, covers its root path and is renewed when used. Server responses are private and never cached.

Existing local trips migrate automatically. The newest 100 trips and feedback are retained; a local cache and persistent outbox support offline changes and retries on reconnect, focus or manual retry. Supported browsers serialize synchronization across tabs with Web Locks. If the cookie is replaced but local records survive, those records are restored into the new private history. There is no account-based cross-device access; export before clearing all browser data or changing devices.

Deletion removes trip content from the database and local cache. A minimal identifier-only deletion marker prevents a delayed upload from recreating the content. Old active-trip writes cannot overwrite completed feedback. Database setup is explicit and idempotent; it is not run on each request.

## Hosting

The app runs at the root of `parkinparis.kepard.dev` on Vercel, with a DNS-only CNAME managed in Cloudflare. The old `kepard.dev/projects/park-in-paris/` page redirects to the new address. Legacy asset and API rewrites remain compatible with already-open tabs.

On the new domain’s first visit, the app imports this browser’s server-saved trips from the old address. A credentialed, same-site GET is allowed only from the exact new origin; cookie secrets remain HttpOnly and host-only. Existing new-domain records and pending edits take priority, and imports pass through normal validation. A persistent migration marker prevents repeated imports; failed transfers retry on focus/reconnect. Old-origin offline changes need to have synced before moving.

No secrets belong in this repository. No account or credential is needed to use the app.

## Optional browser tool

Feature-detected WebMCP exposes `read_parking_recommendations`, a read-only view of the current results. Normal browsing needs no WebMCP support. Registration, empty-state and populated-result reads, and rejection of invalid input were verified in a compatible browser alongside the standard UI.
