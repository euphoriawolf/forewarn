# Forewarn

Forewarn tells you what the rain will do to your street, farm or village in Africa, before it comes. Floods first.

Live: https://forewarn.dawnstackai.com

Built for the Meta Global AI Developer Hackathon (Indie track), from 26 Oct 2026. Built with Muse Spark Open.

## What it does

- **Ask in plain words.** Put a pin on your door and ask "will it flood here this week?". The agent answers with a level (green, amber or red), a chance in words ("1 in 5 forecasts") and what to do.
- **14 days ahead.** The answer uses 51 rain forecasts for the next 14 days, plus a weekly outlook to about a month.
- **How wet the ground is.** The rain of the last 30 days, against 30 years of normal. Soaked ground floods sooner.
- **The last flood in 3D.** In Lagos and Nairobi, the agent plays the water of the last big storm on real ground, buildings and trees. It can light the roads that took water.
- **Send a photo of the water.** SAM 3.1 marks the water and the people. Muse Spark says what the water reaches. The page pixelates the people before it shows the photo or sends it as a report.
- **Flood reports on the map.** A person checks each photo report. After that, it shows for 48 hours on maps within 5 km, and the agent uses it in its answers.
- **Alerts for your area.** Give an email and confirm it. An agent for your area checks the forecast every 6 hours. When a flood is possible in the next 7 days, it writes an alert. A person reads the alert before it goes out.
- **The time machine.** Pick one of 36 past African floods and see what Forewarn would have said 7 days to 1 day before, with today's rules. The scorecard lists every flood, the misses too: 21 of 36 got a warning, 19 of them 3 days or more ahead.
- **Warn your family.** The agent writes a short message from the forecast. You send it on WhatsApp from your own phone.

## How it works

Code makes every number. The model explains the numbers and picks what to show.

1. **Fixed steps run first, in code.** The app finds the place, reads the 51 forecasts, blends the four nearest forecast squares (each about 28 km) and counts the runs that bring the place's flood line in one day, or 50 mm over 3 days.
2. **The model picks optional tools.** Muse Spark Open calls tools for the 3D view, the reports, the ground, the alerts form and the family message.
3. **A checker reads every answer.** It compares each number and each day in the answer with the tool results. If one does not match, the model tries again.
4. **Each followed area has its own agent.** It keeps its last reading in memory and wakes every 6 hours. A rule in code decides: no change, an update, or an alert draft.
5. **A person approves every warning** that goes to someone else. Drafts wait on a review page. Nothing goes out before a person approves it.

The flood line is the rain in one day that floods the place. For Lagos and Nairobi it comes from the Flood Check model runs. For other places it is 30 mm.

## Meta models

| Model | Where | What it does |
|---|---|---|
| Muse Spark Open (`meta-models/muse-spark-open-1026`) | Baseten | The chat agent, its tool calls, the alert text |
| Muse Spark 1.3 | Meta Model API | Reads a flood photo in words |
| SAM 3.1 | Meta Model API | Finds the water and the people in a photo |

We do not use the `-contributor` models. They let Meta train on what we send, and we send people's chats and photos.

## Stack

- Cloudflare Workers and the [Agents SDK](https://developers.cloudflare.com/agents/). The chat agent and the Watch agent of each followed area are Durable Objects with SQLite.
- [Vercel AI SDK 6](https://ai-sdk.dev) for the tool loop, with typed tools (zod).
- React and Vite for the page, MapLibre for the map, three.js for the 3D.
- Cloudflare Email Sending for alerts.

## Code

```
app/
  src/server/   the Worker
    harness.ts    the agent, its tools and the number checker
    forecast.ts   the 51 forecasts, the blend, the level and the "1 in N"
    rain30.ts     the last 30 days against normal
    witness.ts    the photo reading (SAM 3.1 and Muse Spark)
    reports.ts    flood reports and their review queue
    watch.ts      the agent for each followed area
    alerts.ts     followers, alert drafts, sending and its limits
    review.ts     the review page
    past.ts       the time machine and its scorecard
  src/client/   the page, the map, the chat and the 3D
  tools/        scripts that cut the 3D tiles and the rain normals
evals/          the model test, the agent test suite and the false-alarm test
spike/          the first test of Muse Spark Open with a tool
design/         mockups
```

## Run it

You need Node 22, a Baseten key for Muse Spark Open and a Meta Model API key.

1. Install the packages:

   ```bash
   cd app && npm install
   ```

2. Copy `.env.example` to `app/.dev.vars` and fill in the keys. The file must not go into git.
3. Start the app:

   ```bash
   npm run dev
   ```

4. Open the local address that Vite prints.

To deploy to your own Cloudflare account, set each key with `npx wrangler secret put <NAME>`, then:

```bash
npm run deploy
```

| Name | What it is |
|---|---|
| `BASETEN_API_KEY` | Baseten key for Muse Spark Open |
| `MODEL_API_KEY` | Meta Model API key, for SAM 3.1 and Muse Spark 1.3 |
| `REVIEW_TOKEN` | Opens the review page for reports and alerts |
| `ALERTS_TOKEN` | Opens the test route that forces an alert check |
| `LOGS_TOKEN` | Opens the test chat log |

## Tests

The dev server must run first (`npm run dev` in `app/`).

| Command | What it checks |
|---|---|
| `node evals/past-suite.mjs [days] [model]` | The agent answers from the forecast made that many days before each of 36 past floods. Each answer must pass the number checker and give the level that code computed. Last run (28 Oct, 3-day rule), 3 days before, Muse Spark Open: 35 of 36. The miss: Gqeberha, June 2024, right numbers but no level word. |
| `modal run evals/modal_pull.py`, then `python3 evals/rules.py` | Every daily forecast since April 2024 at the flood places, pulled on Modal. Each alert rule is tuned on half the floods, checked on the other half, and scored for alerts with no flood after them. This chose the 3-day rule. |
| `python3 evals/false-alarms.py` | How often soaked ground came with no flood after it, at the same places from 2000 to 2025. |
| `node evals/compare-models.mjs` | The same 10 questions to Muse Spark Open and Muse Spark 1.3: speed, the checker and the tools called. |

## Privacy and safety

- To read a photo, the app sends it to the Meta Model API (SAM 3.1 and Muse Spark 1.3) and keeps nothing. The answer comes back to the phone, and the page pixelates the people.
- The app keeps a photo only when the person sends it as a report. A report holds only the pixelated photo, and a person checks it before others see it.
- An email address gets alerts only after its owner opens the confirm link. Each email has a stop link. An address gets at most 2 alerts a day.
- The family message goes from the person's own phone. Forewarn sends nothing to the family.

## Data and credits

| Data | Source | Licence |
|---|---|---|
| Rain forecast, 51 runs (ECMWF IFS ensemble) and the weekly outlook | [Open-Meteo](https://open-meteo.com) | CC BY 4.0 |
| Rain of the last 30 days | [Open-Meteo](https://open-meteo.com) archive | CC BY 4.0 |
| Normal rain, 1991 to 2020 | [CHIRPS](https://www.chc.ucsb.edu/data/chirps), Climate Hazards Center, UC Santa Barbara | CHC terms, with credit |
| Place search | [Photon](https://photon.komoot.io) and [Nominatim](https://nominatim.org), on OpenStreetMap data | ODbL |
| Satellite map | Esri World Imagery | Esri terms, with credit |
| Past floods | Google Groundsource, news reports placed on a map | CC BY 4.0 |
| Past forecasts (ECMWF IFS ensemble archive) | [dynamical.org](https://dynamical.org) | CC BY 4.0 |
| 3D ground imagery | Sentinel-2 cloudless by [EOX](https://s2maps.eox.at) | CC BY-NC-SA 4.0 |

Photo credits for the landing page are at the bottom of the page itself.

## Work from before the hackathon

All code in this repository is new, written from 26 Oct 2026. Forewarn uses one older project as an input: **Flood Check** (https://flood-check.dawnstackai.com), by the same author. Forewarn reads its public API and its data: ground, buildings, trees and roads. It also uses the Flood Check model runs of the March 2026 Nairobi flood and the June 2026 Lagos flood. The 3D tiles in `app/public/tiles/` come from that data. No Flood Check code is in this repository.

## Limits

- The 3D flood replay exists only for Lagos and Nairobi. Other places get the forecast and the satellite map.
- The forecast squares are about 28 km wide. A level for a street is a level for the area around it, and each answer says so.
- The flood line outside Lagos and Nairobi is a fixed 30 mm. The real line is different for each street.
- Forewarn is not an official warning service. Follow what your local authorities say.
