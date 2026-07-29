# Native subtitle hit-overlay profiling

Measured on macOS arm64 on 2026-07-29 with the repository fixtures and the
bundled pinned FFmpeg 7.0.1/libass 0.17.2 stack. Run:

```sh
node scripts/profile_native_ass_geometry.js 11 --production
node scripts/profile_native_ass_geometry.js 11 --production --batch
node scripts/profile_native_ass_geometry.js 11 --batch
```

The profiler reports medians in microseconds. `--batch` keeps one
`GeometryService` alive, matching the long-lived worker path; without it, the
reported wall/native difference includes helper process startup and JSON/file
handoff.

| Representative cue | Original full-validation native total | Production persistent-session native total | Production persistent-session wall/request |
| --- | ---: | ---: | ---: |
| Plain English ASS | 7.108 ms | 0.782 ms | 1.756 ms |
| Multiline/simultaneous ASS | 6.712 ms | 0.839 ms | 1.684 ms |
| Japanese ASS | 21.240 ms | 3.054 ms | 4.931 ms |

The original path composed six full 1280×720 alpha planes
(5,529,600 pixels) and scanned another 921,600 pixels for a mask on every
request. Normal production requests now process zero alpha pixels. When the
copied-text diagnostic requests a mask, the sample English cue composes and
scans 15,190 cropped pixels; its encoded mask is byte-identical to the retained
full-validation path.

Demuxing was about 87–92 µs per fixture request and was not the dominant cold
cost, but a persistent session reduces a nearby-cue hit to 8–10 µs and retains
libass font/renderer caches. Cold libass shaping remains the largest native
operation: about 4–5 ms for the Latin fixtures and 16–17 ms for Japanese in a
fresh helper. Hot instrumented renders were about 0.67–0.73 ms for the Latin
fixtures and 2.9–3.1 ms for Japanese.

The worker deliberately retains one active source/session. Alternating primary
and secondary tracks with different sources may replace that cache more often,
but remains correct; a bounded multi-session cache is a possible follow-up if
real-player traces show this pattern is material.

The clean native build measured 10.49 seconds at `origin/main` and 10.10 seconds
after this pass on the same machine and dependency stage; the difference is
within normal build noise. The shipped helper decreased from 4,848,032 bytes to
4,265,744 bytes (582,288 bytes, 12.0%) after release symbol stripping. A dSYM is
retained under `build/native-backend/`.

## Regression checklist

Automated coverage exercises persisted-enabled and persisted-disabled startup,
delayed overlay/backend readiness, repeated enablement, disablement during
enablement, exact-PID teardown races, helper timeout/unavailability, settings
classification, rapid generation invalidation, stale geometry responses,
cache/session reuse, seeking/property invalidation, primary/secondary cue
identity, multiline/simultaneous ASS, validation off/on, cropped mask parity,
and duplicate timer/listener prevention.

The following IINA checklist remains the release smoke test because pointer
hit-testing and WebView/player-control interaction cannot be fully asserted by
the Node/native harness:

1. Enable with Shift+H, quit while enabled, restart, and verify the first lookup
   works without toggling.
2. Change a geometry-affecting setting, then several mixed settings rapidly;
   verify lookup continues and the UI does not hang.
3. Disable once and verify the invisible layer no longer intercepts input;
   enable once and verify lookup returns.
4. Switch subtitle tracks, seek in both directions, resize/full-screen the
   window, and exercise primary plus secondary subtitles.
5. Open a second file, close it, and reopen media in the same IINA process;
   verify no stale geometry or duplicate layer.
6. Stop the helper process while a cue is active; verify the layer clears,
   reports failure, and a later request or enablement can start a fresh helper.

Structured logs distinguish desired enablement, overlay runtime state, helper
liveness, native session readiness, hit-layer readiness, generation, worker
creation/destruction, outstanding requests, cache hits/misses, native stage
timings, DOM update time, reconfiguration time, and time to first hit layer.
