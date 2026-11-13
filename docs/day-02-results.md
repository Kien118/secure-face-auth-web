# Day 2 PoC — Implemented on 12 November 2026

This is the Day 2 work milestone; it was not backdated to 6 November. The PoC code was implemented, while physical trials and calibration remain **Pending**. Anti-spoofing and the Final project have not passed acceptance.

## Changes and Architecture

The implementation retained Node/Express, face-api.js 0.22.2, and the three Day 1 models without adding a dependency. After obtaining consent, the browser sends multiple samples only when the user explicitly starts the PoC challenge. Each sample contains a 128D descriptor and 68 landmark coordinate pairs, with no image or video. The server calculates EAR and nose displacement, compares the descriptor against the account bound to the attempt on the server, and checks sample order and receipt times. It does not accept client success flags, steps, timestamps, or replacement accounts.

The initial fixed sequence was:

1. Look straight ahead with eyes open to establish the neutral head reference.
2. Close the eyes and hold them closed until instructed to reopen. Natural-blink detection was not used on slow hardware.
3. Reopen the eyes and look straight ahead.
4. Turn the head so the nose moves toward the left of the preview, keeping the eyes open.
5. Return to the center with the eyes open.

Each step requires two consecutive qualifying samples. A pose that does not match resets the current step's counter and cannot skip a step. Experimental thresholds come from `.env.example`: open-eye EAR 0.25, closed-eye EAR 0.18, head turn 0.20, and center tolerance 0.10. They **have not been calibrated on real participants**. The head measure is a 2D index along the eye axis, not a 3D yaw angle. It uses a neutral reference, with an image-rotation test to avoid confusing in-plane roll with a head turn.

Samples received less than 150 ms apart according to the server clock are rejected. The browser waits 250 ms plus inference/HTTP time between captures. An attempt expires after 45 seconds; at most 100 attempts are held in RAM, and expired slots are reclaimed when a new attempt is created. Completion, invalid sample evidence, identity mismatch, or cancellation consumes the attempt. Sample landmarks/descriptors are not retained. The enrollment template remains in RAM as in the baseline. Restarting the server clears everything.

On sequence completion, the server returns `SEQUENCE_COMPLETE`, `sequencePassed: true`, `liveness: UNVERIFIED_CLIENT_EVIDENCE`, and `authenticated: false`. It does not create a session. The baseline `/api/verify` endpoint remains available and is clearly labeled as identity matching only.

## Checks Performed

| Check | Observation |
|---|---|
| `npm test` | 35/35 passed after adding the eye-reopening cue; temporary copies of tests were not run twice |
| `npm run lint` | 20 JavaScript files passed syntax checks |
| Browser model loading | Passed: after the model-check button was clicked, the in-app browser confirmed that all three models had loaded; the camera remained off |
| PoC page | Consent, baseline/challenge buttons, sequence instructions, and the initial camera state were observed |
| Real templates/descriptors collected during this session | None; tests used synthetic vectors/landmarks or mocks |
| Build | No separate build step; the frontend uses static ES modules |

Unit/integration tests covered a valid sequence, stationary synthetic samples that cannot complete it, reversed order, identity mismatch at a later step, schema and degenerate-landmark validation, forged flags, account binding, expiry/capacity/cancellation/reuse, neutral-relative head movement, the 8 KiB body limit, and responses with no cookie/session. Client tests checked cancellation during inference, no further data after a late creation response, an eye-reopening cue emitted only once, and speech cancellation on completion or abort. A regression test ensures that an old `video.play()` failure cannot stop a newly started stream.

Previously, `npm test` also discovered tests in an ignored source export under `tmp/`. Discovery was restricted to `tests/*.test.js` and verified on Windows/Node 22.13.0. The user's temporary directories and reference files were preserved.

## Running and Testing on Real Devices

```powershell
cd "C:\Users\Trung Kiên\Documents\ChatGPT\Final_BMTT"
npm start
```

If an older server is running, stop it with Ctrl+C and start it again. Open [localhost:3000](http://localhost:3000), load the models, obtain the participant's consent, enable the camera, and create a new template after the restart. Use the baseline 1:1 verification button to obtain an identity reference result, then start the PoC challenge and follow each prompt.

Do not close the eyes for only 0.5 seconds: the browser announces the request to reopen the eyes when the step qualifies, if speech is supported. If no cue is audible, close the eyes for about two seconds, reopen them to inspect progress, and repeat if necessary. Timing needs calibration for the device; physical speaker/voice behavior has not been tested. The preview is not mirrored: move the nose toward the left side of the displayed image. Stop the camera to cancel.

Use the same template throughout each comparison group; do not enroll again using the phone photo. Use only consenting participants and consented photos/videos. Record successes and failures alike.

| ID | Trial | Information to record | Actual result |
|---|---|---|---|
| D2-01 | Enrolled person follows the sequence correctly | Each step, EAR/nose displacement, distance, total time | Pending |
| D2-02 | Enrolled person intentionally uses the wrong action or does not close the eyes | Step that remains incomplete or timeout; no session | Pending |
| D2-03 | Another consenting person claims the same account | Whether NO_MATCH stops the attempt; distance | Pending |
| D2-04 | Hold the enrolled person's phone photo still | Whether baseline matching succeeds; step where the challenge stops | Pending |
| D2-05 | Move the phone photo | Every step advancement or completed-sequence bypass | Pending |
| D2-06 | Tilt the phone screen | Every step advancement or completed-sequence bypass | Pending |
| D2-07 | Change screen brightness | EAR, detection errors, and results at each brightness level | Pending |
| D2-08 | Phone video containing eye and head actions | Whether it completes the fixed sequence; record all bypasses | Pending |
| D2-09 | Stop the camera, withdraw consent, or change tabs during the sequence | Camera stops, capture stops, and no late result is displayed | Pending |
| D2-10 | No face or two faces during the sequence | Message and cancellation of the attempt | Pending |
| D2-11 | Printed photo, if available | Conditions, qualifying/stalled steps, and all bypasses | Pending |

Report using: `ID | device/browser | lighting/distance/phone brightness | last step | EAR/nose displacement/distance | result/time | notes`.
Do not send or commit real images/videos, descriptors, or landmarks.

## Limitations and Next Work

- The server recalculates measures from **client-provided landmarks**; it does not independently establish that those points came from a camera. A modified client can complete the sequence using fabricated data.
- A prerecorded video may match the fixed sequence. Synthetic tests verify the algorithm, not that phone photos are blocked. Moving/tilting phones require real trials.
- Eye/head thresholds, camera quality, latency, and each participant's ability to perform the actions require calibration. No accuracy or certified-PAD claim is made.
- Enrollment remains an unprotected baseline enrollment rather than challenge-protected enrollment. There are no login accounts, sessions, encrypted database, rate limits, or complete authentication protocol.
- Stopping the camera aborts client processing and requests DELETE. If the network fails, attempt metadata may remain until its TTL and subsequent cleanup. A request already received by the server cannot be retracted.

At the end of the Day 2 implementation session, Day 3 remained planned: server-owned random action order/direction, stronger freshness and binding, and real video/photo trials. If bypasses persist, independently verified evidence or PAD should be considered according to licensing and runtime feasibility. This report records the historical Day 2 state rather than claiming that later work was already present.

For Day 1, the user confirmed that both 0.5910/0.2142 trials used the enrolled person. Other-person and phone-photo trials remain Pending. At the Day 2 handoff, publication awaited the user's repository URL. The existing snapshot was subsequently pushed on 12 November 2026 as `f6a384b` to [Kien118/secure-face-auth-web](https://github.com/Kien118/secure-face-auth-web).

PoC code commit: `e3f321f`; eye-reopening cue: `a5e02ea`. Documentation and verified test results were committed separately after checks. Git contains no real face images, videos, descriptors, or landmarks.
