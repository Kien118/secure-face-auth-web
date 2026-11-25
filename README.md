# Face Authentication for Web Applications

Day 1 (November 5, 2026): webcam-based 1:1 identity matching baseline.
Day 2 (implemented November 12, 2026): an eye-closure and head-turn challenge PoC.
Day 3 (November 12–13, 2026): randomized actions, one-time sample tokens, and a redesigned workspace.
Day 4 (November 24, 2026): server-measured evidence (JPEG frames), login sessions, encrypted
persistent templates, per-account lockout, and an account page.
**Phone-photo trials have not been recorded yet. This is challenge-response, not certified PAD.
Do not use this prototype in production.**

## Final project requirements

Topic 2 in `SECURITY PROJECT TOPICS_CLC_2026.pdf`, page 1, requires a secure web
login page using a JavaScript face-processing library, webcam authentication, and
successful rejection of a spoofing attempt such as a face photograph on a phone.
Anti-spoofing is a mandatory acceptance criterion. Identity matching alone does
not satisfy the assignment. The agreed plan prioritizes a liveness PoC on Days 2–3,
phone-photo and phone-video trials, and printed photographs where practical.

## Architecture and Midterm alignment

The implementation follows the Midterm PDF (24 pages), extracted presentation
content, and the previously agreed 15-day plan. The original local research
materials remain in the ignored `tmp/read_inspection/` directory.
Midterm sections 7.2–7.5 and 8 propose HTML/CSS/JavaScript, face-api.js/TensorFlow.js,
and Node.js/Express in a hybrid architecture. The initial workspace contained an
empty Git repository on `main`, research materials, and no existing application,
README, AGENTS.md, or project rules to reuse.

Browser: consent → webcam → transient frame → Tiny Face Detector (exactly-one-face
gate for fast feedback only) → JPEG frame → same-origin POST. Enrollment sends 3
frames, the baseline sends 1, and the challenge sends one frame per sample.
The browser computes no descriptor or landmarks, so editing client JavaScript cannot forge evidence.

Server: decode JPEG → `@vladmandic/face-api` on the TF.js WASM backend
(`src/services/face-analyzer.js`) runs SSD MobileNet v1 + the full 68-point landmark net,
which keep tracking turned and tilted faces that the browser's tiny models lose, plus the
pinned recognition net (byte-identical to the browser copy, so stored templates stay valid). During a challenge the browser sends frames even when its tiny
detector misses the face; the server decides (about 0.3–0.5 s per frame on a laptop CPU).
Turn and tilt thresholds were set with the tiny landmarks and should be re-checked.
Server output: descriptor + 68 landmarks → strict validation → account-bound template → Euclidean
distance → `distance <= threshold`. Frames are processed in memory and discarded.
Templates are stored in `data/templates.json`, each sealed with AES-256-GCM using the
account ID as associated data (`src/services/template-store.js`). A completed challenge
creates a server-side session (`sid` cookie, HttpOnly, SameSite=Strict); the
identity-only baseline never does. It compares only the claimed account (1:1),
checks the challenge sequence, and ignores client-provided success claims.
Express serves both the static frontend and API. No frontend bundler is required.

Browser inference deliberately avoids native TensorFlow/canvas dependencies and
continuous video upload. No native Node compatibility failure was concealed.
The Node CPU script is only a synthetic model smoke test. The local challenge
randomizes action order and turn direction, has deadlines, and is consumed on
completion, invalid evidence, or cancellation. Independent PAD, authenticated
sessions, and protected persistent storage are still pending.

## Technology

- Development environment: Windows, Node.js 22.13.0, npm 10.9.2, Git 2.48.1.windows.1.
- Express 5.3.0, Helmet 8.3.0, face-api.js 0.22.2 with TensorFlow.js core 1.7.0.
- A `node-fetch` 2.7.0 override addresses the advisory in the older TF.js dependency.
- `package-lock.json` pins dependencies; `models.lock.json` pins model source and SHA-256 hashes.
- Model/API source: [official face-api.js repository](https://github.com/justadudewhohacks/face-api.js).
  Its [MIT license](https://github.com/justadudewhohacks/face-api.js/blob/master/LICENSE)
  is downloaded alongside the weights. The downloader does not fetch face datasets.
- The README, project reports, interface, and spoken instructions use English.

## Installation and reproducible startup

Requirements: Node.js >=22.13.0, npm, a webcam, and a browser supporting
`getUserMedia` and WebGL/CPU inference.

```powershell
npm ci --ignore-scripts
npm run models:download
if (!(Test-Path .env)) { Copy-Item .env.example .env }
npm test
npm run lint
npm run check:models
npm run dev
```

Open [localhost:3000](http://localhost:3000). Use `npm start` without file watching.
Stop a running server with Ctrl+C before restarting it. Restarting also deletes
all templates and challenges in RAM.

`lint` runs `node --check` over project JavaScript files; it is a syntax check,
not ESLint. There is no separate build step: the frontend uses static ES modules.
`check:models` verifies checksums, loads three networks, and produces a descriptor
from a synthetic tensor. It does not evaluate detection or recognition on people.

Model files go into the ignored `public/models/` directory. If downloading fails,
check the connection and retry; do not bypass checksum validation. Keep weights
out of Git. The source commit for npm release 0.22.2 is
`8609b25a15f417398a4d2b95dc91985cd1e0c0c3`.

## Configuration and calibration

The server automatically reads the optional, ignored `.env` file.
Defaults: `HOST=127.0.0.1`, `PORT=3000`, `FACE_MATCH_THRESHOLD=0.6`.
The identity threshold starts from the library's FaceMatcher baseline and has
**not been calibrated or formally evaluated**. Calibrate using separate,
consented genuine/impostor captures. Do not tune on evaluation trials and then
report the same trials as an independent evaluation. Restart after changing configuration.

Experimental hardware calibration settings are provided in `.env.example`:

| Variable | Initial value | Meaning |
|---|---:|---|
| `LIVENESS_TIMEOUT_MS` | 45000 | Overall challenge lifetime, using server time |
| `LIVENESS_STEP_TIMEOUT_MS` | 15000 | Per-step lifetime, bounded by the overall deadline |
| `LIVENESS_EYE_OPEN` | 0.25 | Minimum eye aspect ratio (EAR) for open eyes |
| `LIVENESS_HEAD_TILT_DEG` | 12 | Required head tilt (eye-line roll, degrees) relative to the user's own neutral pose |
| `LIVENESS_HEAD_LEVEL_DEG` | 6 | Maximum roll for "straighten your head" and for a stable neutral baseline |
| `LIVENESS_HEAD_TURN` | 0.15 | Required nose offset relative to the initial neutral pose (a slight turn) |
| `LIVENESS_HEAD_CENTER` | 0.10 | Neutral-pose tolerance |

EAR averages the eyelid-distance/eye-width ratio for both eyes. Nose displacement
is projected onto the inter-eye axis and normalized by inter-eye distance; it is
not a 3D yaw angle. Both landmark axes are normalized by the larger frame dimension
to preserve geometry. The server recomputes these metrics from 68 client-provided points.

Each step needs two consecutive qualifying samples. The server rejects samples
less than 150 ms apart. The browser waits at least 250 ms between captures, plus
inference and HTTP latency. Observe the displayed EAR/nose offset during consented
calibration, record the configuration and conditions, and evaluate on new trials.
These settings are not PAD standards. Two successful matches are insufficient calibration data.

HTTP is limited to loopback development. Any non-local setup requires trusted
HTTPS through a same-origin reverse proxy, with HSTS configured at that proxy.
Do not expose this PoC to the Internet or bypass certificate warnings.

## Webcam and challenge usage

You can select **Check models** before granting camera access.

1. Read the data notice and check the participant's consent box.
2. Select **Start camera**, then grant browser camera permission. The app loads the models if needed.
3. Use a pseudonymous account identifier: 1–64 letters, digits, `_`, or `-`.
4. Show exactly one face and select **Create test template**.
5. Select **Verify baseline 1:1** to inspect identity distance. A match is not a login.
6. Select **Start randomized challenge** and follow the current instruction.
7. Select **Stop camera** to cancel. Hiding the page or withdrawing consent also stops capture.

The FaceLab workspace shows the current instruction, completed steps, and separate
countdowns for the current step and the whole attempt. The countdowns display server
deadlines; the server decides whether a step or attempt has expired. The Measurements
panel shows the latest available values and clears them when a new check starts.
Changing the idle test account also clears previous results, so a result for one
account is not displayed beside another account's identifier.

If port 3000 is already in use, open the running app if it is yours, or run
`$env:PORT = '3001'; npm start` in PowerShell and open [localhost:3001](http://localhost:3001).

Every challenge starts with a neutral pose (eyes open); its nose offset and eye-line angle become
the user's own baseline. The server then draws 3–5 further actions from five poses
(center, turn left/right, tilt left/right). Each action may be any pose except the previous one,
so there is no fixed "act, then return" rhythm (a turn can go straight into a tilt). Each action
must be held for a random 2 or 3 consecutive samples, which the server never reveals.
That gives 4³ + 4⁴ + 4⁵ = 1,344 action sequences (before hold timing), against 8 in Day 4's
first version. Follow each displayed prompt rather than memorizing a previous attempt. The preview is mirrored (CSS only; frames sent to the server are not),
and prompts use the user's own left/right. Action names keep raw-image coordinates:
`turn_left` (nose toward image left) is shown as "Turn to your right".

Day 4 replaced the close/open-eyes block with a head tilt: with eyes closed a user cannot
read the next prompt, which forced a spoken cue. Mouth-open and smile were tried and dropped:
the tiny face models lost the face or its identity match on strong expressions, while a tilt
keeps a neutral expression. The eyes now stay open for the whole attempt,
so the speech cue was removed. If a frame has no face (for example a turn that goes too far),
it is skipped: the token does not rotate, the step deadline keeps running, and the attempt
continues. Multiple faces still end the attempt. Tilt and turn thresholds are uncalibrated.

Wrong identity, no face, multiple faces, cancellation, or expiry ends the attempt.
Start a new attempt after an error. `SEQUENCE_COMPLETE` only means the submitted
evidence met the PoC sequence rules; `authenticated` remains `false`.

Baseline/template actions use one frame. The challenge captures multiple frames
only after an explicit start. Frames are transient; no images, video, descriptors,
or landmarks are logged or written to browser storage. Samples are not retained
by the server. Templates stay only in RAM and disappear on server restart.
Existing templates cannot be freely overwritten; restart to reset the experiment.

## Experimental API

| Endpoint | Input / result |
|---|---|
| GET `/api/health` | status ok, server-evidence-challenge, pad false, sessions true |
| POST `/api/templates` | `{accountId, frames: [3–5 JPEG data URLs]}` → 201 TEMPLATE_CREATED (frames must show one consistent face) |
| POST `/api/verify` | `{accountId, frame}` → MATCH/NO_MATCH, distance, threshold, authenticated false (baseline only) |
| POST `/api/liveness/challenges` | `{accountId}` with a template → challengeId, current action/prompt, sampleToken, step, deadlines; 429 LOCKED after 5 failures |
| POST `/api/liveness/challenges/:id/samples` | `{frame, sampleToken}` → progress/new token, NO_MATCH, or SEQUENCE_COMPLETE + `Set-Cookie: sid` + authenticated true |
| DELETE `/api/liveness/challenges/:id` | Cancel, returning 204; consumed IDs cannot advance again |
| GET `/api/session` | 200 with accountId for a valid session cookie, else 401 |
| POST `/api/logout` | Destroys the session |
| DELETE `/api/templates/me` | Logged-in owner deletes their template (erasure) and all their sessions |

Baseline requests accept exactly two fields. A challenge sample requires a
128-number descriptor, exactly 68 finite coordinate pairs in [0,1], and the
server-issued 64-character hexadecimal token. The server uses its stored account;
it does not accept account, step, timestamp, or success flags from a sample.

The token rotates after every accepted sample, including a non-qualifying pose.
A stale or cross-challenge token consumes the attempt. Do not automatically retry
a POST whose response was lost: cancel and start over. Wrong poses do not extend
deadlines. Overall expiry returns CHALLENGE_EXPIRED; step expiry returns STEP_EXPIRED;
an invalid or reused token returns INVALID_SAMPLE_TOKEN.

Schema/descriptor/landmark failures reaching the challenge service and identity
mismatches consume the attempt. Up to 100 challenges are retained in RAM; expired
slots are reclaimed when creating another challenge. Sample descriptors/landmarks
are not stored. Only the plan, current token, account, timing, counters, and scalar
neutral-pose measurements are retained.

Descriptor values must be finite numbers with absolute value <=10 to reject
extreme numeric input; this is not a biometric quality gate. JSON is limited to
8 KiB, except the three frame routes (1 MB). Missing templates return 404, duplicate templates 409, and template capacity
(100 per instance) 503. Invalid JSON returns 400, wrong content type 415, and
oversized bodies 413. API query strings and cross-site POSTs indicated by
Sec-Fetch-Site are rejected. CORS is not enabled. These are not production login APIs.

## Results and manual testing

[Day 1 results](docs/day-01-results.md) record two user-reported genuine matches:
0.5910 and 0.2142. Conditions remain incomplete, so these are not an accuracy study.
The fixed-sequence checklist is in [Day 2 results](docs/day-02-results.md).
The randomized local protocol and checklist are in [Day 3 results](docs/day-03-results.md).
On November 13, the user reported that the enrolled participant could complete the
challenge; trial count, devices, conditions and measurements were not supplied.
Repeated genuine-user trials, other consented participants, and phone photographs/videos
remain **Pending**. The user has not yet tried the phone-photo test. Report trial ID,
devices, conditions, distance, final step, outcome, and errors. Do not share face media or descriptors.

## Security limits and next steps

The implementation uses CSP/security headers, no-store responses, strict
validation, and server-owned matching/sequence decisions. Git excludes secrets,
real biometric captures, and model weights; tests use synthetic inputs.

Descriptors and landmarks are now measured by the server from submitted frames, so a
modified client can no longer send made-up numbers. It can still send frames that do not
come from a real camera (a virtual camera or a recorded video): token binding rejects
unchanged old requests but does **not** establish fresh or genuine camera input. With 1,344 sequences and hidden hold counts a
prerecorded clip is unlikely to match, but an attacker who records many poses and switches
clips live (or a real-time deepfake) can still follow the prompts. Moving or tilting
a display can also affect pose estimates. Physical trials are required.

Trusted enrollment (binding a face to an already-verified account), passive PAD,
and PAD certification are not implemented. Sessions and the lockout counter live in
memory and reset on restart. The template key is a local file (`data/template.key`)
unless `TEMPLATE_KEY` is set; keep `data/` out of Git and backups you share.
The face-api.js/TF.js stack is old; a clean dependency audit is not a security guarantee.

This snapshot includes Day 3's randomized challenge, one-time tokens, step deadlines,
and workspace improvements. Hardware calibration and presentation-attack
trials remain pending; database/session work has not started. Choose further PAD
work from observed failures rather than assuming that eye/head actions prove liveness.

## GitHub

[Kien118/secure-face-auth-web](https://github.com/Kien118/secure-face-auth-web),
branch `main`, includes the Day 1–2 implementation and GitHub initialization at
`f6a384b`. The user requested publication of the Day 3 changes, English-language
documentation, and redesigned workspace on November 13, 2026. Those changes are
included in this snapshot. Further commits and pushes require a user request.
