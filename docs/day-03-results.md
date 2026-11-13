# Day 3 PoC — implemented on November 12, 2026

Day 3 development continued locally after the Day 1–2 version was pushed to GitHub.
Stabilization and browser checks continued on November 13, 2026. The user reported that
the enrolled participant could complete the challenge. Repeated physical trials and
calibration remain **Pending**. Anti-spoofing and Final acceptance are incomplete.

## Scope of changes

Node/Express, face-api.js 0.22.2, the three existing models and the 8 KiB JSON limit
are unchanged. No dependencies were added. Images, video and individual sample
landmarks/descriptors are not written to disk. Test templates and challenge state remain in RAM.

The server uses `crypto.randomInt` to choose the order of two action blocks and the
head-turn direction. Every attempt starts with a neutral, eyes-open pose, followed by both blocks:

- Close eyes → open eyes.
- Turn the nose toward the left **or** right side of the image → return to center.

There are **four possible plans**, each containing five steps. The server returns
only the current action and prompt, without revealing future steps. The browser follows
the returned `action`, including when eye reopening is the final step; it does not assume
that reopening always occurs at step 3. Each step requires two consecutive qualifying
samples, with 1:1 identity verification on every sample.

The default deadlines are 45 seconds for the whole attempt and 15 seconds per step,
measured by the server clock. An incorrect action resets the consecutive-sample counter
without extending the step deadline. A new step deadline is capped by the overall deadline.
The browser updates deadlines from responses and checks them before and after inference
to avoid sending another sample after it has detected expiry.

## Tokens and challenge binding

Each active response contains a random, 64-character hexadecimal `sampleToken`.
Sample requests contain only `{descriptor, landmarks, sampleToken}`. The account is
taken from server state. The server checks the token format and length before comparing
it with `timingSafeEqual`.

The token rotates after every accepted sample, including samples with an incorrect action.
A missing, invalid, cross-challenge or previously used token is rejected and consumes the
attempt. Invalid evidence, identity mismatch, expiry, cancellation and completion also prevent
further progress with that attempt. The browser sends samples sequentially using the latest
token. If a POST response is lost, it cancels the attempt instead of retrying the old token.
Concurrent duplicate requests cannot advance twice using one token.

Completion returns `SEQUENCE_COMPLETE`, `sequencePassed: true`,
`liveness: UNVERIFIED_CLIENT_EVIDENCE` and `authenticated: false`; no session is issued.
Tokens bind requests to challenge state. **They do not prove that camera data are fresh.**

## Automated and browser checks

| Check | Day 3 result |
|---|---|
| `npm test` | Passed on November 13: 59/59 tests, including 54 top-level tests and five app-flow subtests |
| `npm run lint` | Passed: syntax checks for 23 JavaScript files |
| Diff and sensitive-data review | `git diff --check` passed; known secret patterns and the changed assets were reviewed |
| Day 3 browser interface and models | On November 13, the redesigned English workspace loaded all three models with the camera off. Starting without consent showed Consent required. Editing the test account showed Account updated. |
| Narrow-screen browser check | Inspected at a 390 × 844 viewport override. The checklist expanded and the model button measured 44 px high. No horizontal overflow at 390 px or 320 px viewport overrides; the desktop viewport was restored. This is a browser layout check, not a phone-camera test. |
| Project language | README, all day reports, UI messages, server prompts and spoken cues are in English; existing filesystem paths are preserved |
| Physical camera, audio and hardware behavior | Enrolled-user completion reported by the user on November 13; trial count, software version, devices, conditions, measurements and audio behavior were not provided. Phone-photo testing was explicitly reported as not yet attempted. |

Coverage includes all four plans, current-action-only responses, token rotation for correct
and incorrect actions, stale/cross-challenge tokens, concurrent duplicate requests, step and
overall expiry, account binding, identity mismatch, schema/body limits, cancellation during
inference, updated client deadlines, and eye-reopening cues based on `action` rather than a
fixed step number. Synthetic vectors and landmarks test logic; they do not replace physical PAD evidence.

The FaceLab redesign adds a larger camera preview, grouped setup and capture controls,
server-driven step progress and countdowns, and a separate measurement panel. UI tests
cover stale metrics, timer cleanup, and the distinction between an identity match and
sequence completion. An occupied-port regression checks for a clear startup message
without a secondary `TypeError`.

The November 13 fixes clear previous results when the idle test account changes and
prevent a cancelled attempt's delayed cleanup from cancelling a newer attempt's spoken
cue. Speech failures do not prevent server cleanup. App-flow tests exercise the actual
browser modules with synthetic media, inference and transport: consent, model readiness,
account changes, network failures, stopping during capture and consent withdrawal.
Screenshots are local artifacts under the ignored `tmp/ui-checks/` directory and contain no face media.

## Physical test procedure

1. Run `npm start`, open [localhost:3000](http://localhost:3000), load the models and
   grant camera permission after participant consent. Create a new template if the server restarted.
2. Verify the enrolled user with the baseline, then start a challenge and follow its current
   prompt. Do not assume the previous sequence. Left/right refer to the unmirrored preview.
3. Keep eyes closed until the reopening cue if browser speech is available. If no cue is
   audible, close them for about two seconds, reopen to inspect progress, and repeat if needed.
   Record device limitations; the required timing still needs hardware calibration.
4. Keep the same template when comparing live people, photos and video. Start a new
   challenge for each attempt. Do not enroll the phone photo as the template. Use consented inputs only.

| ID | Input or action | Information to record | Observed result |
|---|---|---|---|
| D3-01 | Enrolled user attempts the challenge | Trial count, direction/order, final step, duration and distance | User-reported completion on November 13. Count and conditions were not provided; repeated-trial evaluation remains pending. |
| D3-02 | Enrolled user performs incorrect actions or waits for expiry | Stopping step and error code; no session | Pending |
| D3-03 | Another person claims the same account | Distance and whether NO_MATCH stops the attempt | Pending |
| D3-04 | Enrolled user's photo held still on a phone | Baseline and challenge results; any progress or bypass | Not yet attempted, as reported by the user on November 13. |
| D3-05 | Move the phone photo | Every attempt's result, including any bypass | Pending |
| D3-06 | Tilt the phone screen | Approximate angle and steps reached or blocked | Pending |
| D3-07 | Change screen brightness | Brightness, detection errors and results | Pending |
| D3-08 | Replay phone video repeatedly or from different offsets | Whether the video matches a plan; include every bypass | Pending |
| D3-09 | Adapt or seek video in response to prompts, if feasible | Adaptation method and every bypass | Pending |
| D3-10 | Cancel, switch tabs, revoke permission, or present no/two faces | Camera shutdown, no further progress and no late result | Pending |

Report the test ID, browser/camera/phone, lighting/distance/brightness, direction/order,
final step, EAR/nose offset/distance and outcome. Include failed attempts. Do not send
or commit real images, video, descriptors, landmarks or tokens.

## Limitations and publication

- With only four plans, prerecorded video can still match a plan. Adaptive video or a
  forged client can produce matching evidence. Randomization does not guarantee replay rejection.
- Measurements still use client-supplied landmarks. There is no independent PAD or
  evidence verification proving the camera source, trusted enrollment, login session or accuracy evaluation.
- Eye/head thresholds and timing require real hardware calibration. The reported
  enrolled-user completion is an observation with incomplete conditions, not a measured
  success rate. No photo/video results are available, so spoofing prevention is not claimed.
- The [GitHub repository](https://github.com/Kien118/secure-face-auth-web) received the
  Day 1–2 snapshot at `f6a384b`. On November 13, the user requested that the Day 3
  changes, English translations, and workspace improvements be committed and pushed.
  They are included in this publication snapshot. Model weights, local configuration,
  temporary screenshots, and biometric media remain excluded from Git.
