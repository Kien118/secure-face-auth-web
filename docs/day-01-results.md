# Day 1 Results — 5 November 2026

Status: **The baseline is implemented, and the user reported two MATCH results for the enrolled person. Day 1 is not fully complete because other-person and phone-photo trials, together with the required test conditions, have not been documented in full.**
The Final project is also incomplete: anti-spoofing is a Must have requirement and was not implemented on Day 1.

## Initial State and Reference Material

- Git branch `main` had no commits or remote; only `tmp/read_inspection/` was untracked.
- No application source, README, AGENTS.md, or project rules were found in the workspace or the parent paths checked.
- The Midterm, official Topic 2 requirements, and agreed 15-day plan were reviewed again using the earlier three-document comparison discussion. All original reference files were preserved and excluded from Git.
- The implementation retained the hybrid HTML/CSS/JavaScript, face-api.js/TensorFlow.js, and Node.js/Express architecture. The server owned the matching decision; challenges, PAD, and sessions were not yet implemented.

## Actual Environment

| Component | Version / conditions |
|---|---|
| OS | Windows, PowerShell |
| Node / npm | 22.13.0 / 10.9.2 |
| Git | 2.48.1.windows.1 |
| Express / Helmet | 5.3.0 / 8.3.0 |
| face-api.js / TF.js core | 0.22.2 / 1.7.0 |
| node-fetch override | 2.7.0 |
| Models | Tiny Face Detector, tiny 68-point landmarks, 128D face recognition |
| Model source | Commit 8609b25a15f417398a4d2b95dc91985cd1e0c0c3, MIT notice, pinned SHA-256 checksums |
| Threshold | Initial value 0.6; not calibrated on real participants |
| Web | Loopback localhost:3000; HTTP for local use only |
| Observed browser | ChatGPT in-app browser; initial page opened successfully |
| Webcam / phone / lighting | Pending — device information has not been collected |

## Implemented Features

- Express serves the frontend and API from the same origin, including a health endpoint.
- Consent precedes camera use. The UI supports start/stop, preview, stopping when the page is hidden or left, and permission/device errors.
- Models load from the same origin; a separate button checks model loading without opening the camera.
- One temporary frame is captured in RAM. All faces are detected, and exactly one face is required before obtaining landmarks and a descriptor. Images are not saved, and continuous video is not uploaded.
- Descriptors are POSTed to the API using an exact two-field schema: 128 finite numbers, abnormal-value checks, and an 8 KiB JSON limit. Client `matched` or `authenticated` flags are not accepted.
- Templates are held separately by account in RAM, with a limit of 100 and no unrestricted replacement. No database is used.
- The server calculates Euclidean distance and returns match/non-match with `authenticated: false`.
- Security headers, CSP, and no-store are set. Descriptors are not logged. `.env`, weights, and temporary reference files are ignored by Git.
- The downloader checks pinned checksums and retains the upstream MIT notice. It does not download real face photographs.

## Automated Checks Run

| Command / check | Observed result |
|---|---|
| `npm install --ignore-scripts` | Installed successfully; the initial three advisories were addressed with the node-fetch override |
| `npm audit --audit-level=low` | 0 vulnerabilities after the patch |
| `npm test` | **13/13 passed**, 0 failures; synthetic data and mocks only |
| `npm run lint` | **15 JS files passed** Node syntax checks; ESLint was not used |
| `npm run models:download` | Downloaded three manifests, four shards, and LICENSE; checksums passed |
| `npm run check:models` | Loaded three networks; a zero tensor produced 128 finite values |
| `npm start` | The entrypoint started at 127.0.0.1:3000 |
| HTTP/frontend | Health, HTML, modules, and browser bundle returned 200; header checks passed |
| Build | Not applicable: static ES modules without a bundler |

The 13 tests covered backend/health, static assets/headers, schema/dimensions/accounts, NaN/Infinity/JSON overflow, body limits, content type/query/cross-site handling, forged flags, missing templates, RAM templates and 1:1 matching, distance/threshold, template isolation/capacity/copying, camera lifecycle and cancellation while permission was pending, playback errors, zero/multiple-face gates, and model-load retries.
Camera mocks and synthetic tensors are **not evidence of physical webcam testing**.

The first sandboxed HTTP run failed because it could not connect to loopback. It was rerun outside the sandbox with permission, and 13/13 tests passed. Tests were not changed to conceal the failure. Native TensorFlow/canvas was not installed; browser inference was selected consistently with the Midterm. No native failure was concealed. The TF.js suggestion to install a native backend during the CPU smoke test was a performance notice; the test still passed.

## Clean Source Verification

Committed source was exported with `git archive` from `8667063` into an ignored temporary directory. `node_modules`, `.env`, and weights were not copied from the working directory.

- `npm ci --ignore-scripts`: installed 78 packages from scratch; audit reported 0 vulnerabilities.
- `npm test`: 13/13 passed in the clean source export.
- `npm run lint`: 15 files passed in the clean source export.
- `npm run models:download`: downloaded assets again from the pinned source; checksums passed.
- `npm run check:models`: three networks loaded, and 128D tensor inference passed in the clean source export.
- Smoke test of the actual `src/server.js` entrypoint with PORT=0: startup succeeded, and health/HTML returned 200.
- This verifies the runtime from clean source; it does not establish that a physical webcam works.

## Browser Observations and Physical Camera Results

The page opened in the in-app browser, showing the interface, consent control, camera/template/verification buttons, the no-liveness warning, the initial permission state, and a Pending checklist. Browser control was then lost ("tab not part of session" / "tab not found"), so interaction and model loading could not be directly verified during that attempt.

The user subsequently reported these two displayed results. On 12 November 2026, the user confirmed that both trials used the person who had created the template. Device information and test conditions were not supplied.

| User-reported trial | Result | Displayed distance | Threshold | Liveness |
|---|---|---:|---:|---|
| Trial 1 | MATCH | 0.5910 | 0.6 | Not implemented |
| Trial 2 | MATCH | 0.2142 | 0.6 | Not implemented |

Both displayed distances are below the initial 0.6 threshold; Trial 1 is closer to the threshold. M1 records 2/2 enrolled-person trials reported as MATCH, which is not a formal accuracy evaluation. It is unknown whether pose or lighting changed between trials, so M2 remains Pending. These two trials do not provide a basis for threshold calibration. No login session or liveness result was produced.

## Checklist for the User

Open [localhost:3000](http://localhost:3000), or run `npm start` if the server is stopped. Check model loading first, obtain the participant's consent, enable the camera, and grant browser permission. Use a pseudonymous account such as `demo-user`. Keep the same template throughout each comparison group. Restart the server to clear all templates when a fresh enrollment is needed.

| ID | Procedure | Baseline expectation / information to record | Actual result |
|---|---|---|---|
| M0 | Check model loading without opening the camera | Three models load in the browser; record browser/errors | Passed when the updated PoC was checked in the in-app browser on 12 November 2026 |
| M1 | Consenting participant creates a template and verifies again | Record distance, threshold, match result, camera, and lighting | User reported two MATCH results: 0.5910 and 0.2142; device/conditions still missing |
| M2 | Same person with slight pose and lighting changes | Record each attempt, including non-matches | Pending |
| M3 | Another consenting person claims the M1 account | Expect NO_MATCH; record distance and actual result | Pending |
| P1 | Hold the enrolled person's photo still on a phone | A match is possible; record phone, brightness, distance, and result | Pending |
| P2 | Move the phone photo | Record distance/match or no-face as observed | Pending |
| P3 | Tilt the phone screen | Record approximate angle, distance, and result | Pending |
| P4 | Change screen brightness | Record brightness and the result of each attempt | Pending |
| C1 | Stop the camera during processing | Tracks stop and the client operation is cancelled; record any errors | Pending |
| C2 | Deny camera permission initially | Permission-denied message; no descriptor sent | Pending |
| C3 | Show no face | NO_FACE; no descriptor sent | Pending |
| C4 | Two consenting faces enter the frame | MULTIPLE_FACES; no template creation or verification | Pending |
| C5 | Revoke permission or switch tabs | Camera stops; capture does not continue | Pending |

Report results using: `ID | browser/camera/phone | lighting/pose/brightness | distance (if available) | match/non-match/no-face/error | notes`. Do not send descriptors, face images, or real names. Two enrolled-person results have been reported; other-person and phone-photo results have not. Do not infer that a phone photo was accepted from theory or synthetic vectors.

## Limitations and the Day 2 Decision

- A phone photo may retain enough identity information to match. This is a baseline risk, not an observed phone-photo result from this session.
- Client descriptors can be forged or replayed. Day 1 did not implement trusted enrollment, liveness, transactions, sessions, rate limiting, or persistent storage. CSP and validation do not resolve those limitations.
- The threshold is uncalibrated. The conditions of the two reported trials and behavior on the user's devices still need confirmation.
- Restarting the server loses templates. Stopping capture cannot retract a request already received by the server.
- Day 2 was not implemented during the original Day 1 session. Work continued on 12 November 2026; see [Day 2 results](day-02-results.md). Its first task was an eye/head-turn sequence PoC using transitions across multiple frames and real participant/phone-photo testing. Day 3 was planned to add random challenges, TTL, single use, and video trials.
- Further PAD decisions must rely on actual results. Simulated blink/pose data must not be used to claim that liveness has passed.

## Git / GitHub

- `8667063`: webcam baseline, models, in-memory matching API, and 13 tests.
- The README and this report were committed separately after checks.
- At the original Day 1 handoff, the user planned to create the public `secure-face-auth-web` repository and provide its URL. No remote or push existed at that point, and the repository was not created automatically.
- Subsequent publication on 12 November 2026 pushed snapshot `f6a384b` to [Kien118/secure-face-auth-web](https://github.com/Kien118/secure-face-auth-web). This does not change the historical Day 1 test results.
- Commits contain no `.env`, face images, real descriptors, model weights, secrets, or temporary reference files.

**Day 1 is not marked complete:** add the missing conditions for the two reported trials and perform/document the remaining M2–M3/P1–P4/C1–C5 checks.
