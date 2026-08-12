# Maintainability and performance audit

Baseline: `a420137ca980fdd13c7d2ad58b406f173aa6b0f4` (2026-07-29).

This pass prioritised fewer shipped concepts and less handwritten production
code. Counts below use physical lines so they are reproducible. "Handwritten
production" means `src/main`, `src/languages`, `src/overlay`, and
`src/dictionary-manager`; native code is reported separately.

## Outcome

| Measure | Baseline | After | Change |
| --- | ---: | ---: | ---: |
| Handwritten production lines | 24,888 | 24,569 | -319 |
| Generated runtime lines | 25,047 | 24,730 | -317 |
| Native C++/header lines | 3,308 | 3,358 | +50 |
| Named function declarations | 855 | 857 | +2 |
| Main top-level mutable declarations | 88 | 88 | 0 |
| Production timer sites | 31 | 30 | -1 |
| `setInterval` sites | 4 | 4 | 0 |
| Overlay/Settings listener sites | 80 | 80 | 0 |
| Owned runtime caches | 8 | 8 | 0 |
| Overlay bridge JSON message types | 11 | 11 | 0 |
| Legacy raw popup-message aliases | 6 | 0 | -6 |
| Settings representations | 2 | 2, cross-validated | 0 |
| Duplicate startup entry paths | 2 | 2 | 0 |
| Standalone test lines | 16,866 | 17,096 | +230 |
| Build/test script lines | 1,041 | 1,320 | +279 |

The native increase is limited to checked file I/O, request size/ID validation,
response-path protection, and adaptive worker idling. The test/tooling increase
does not ship inside `main.js`.

Generated sizes after the pass are 555,154 bytes for `main.js`, 267,005 bytes
for `overlay.html`, and 66,720 bytes for `dictionary-manager.html`. The
installable package remains approximately 2.00 MB; the audit and validation
metadata offset the smaller runtime in the compressed archive.

## Ownership and direct flows

```text
IINA events
  -> lifecycle and subtitle polling (60/99)
  -> subtitle/style and native hit geometry (10/12)
  -> overlay

Settings/profile event
  -> validate/normalise focused values (15)
  -> write manifest/preferences (20)
  -> apply targeted runtime effects

Hover event
  -> validated handler registry (50)
  -> language candidate selection and bounded lookup cache (30)
  -> committed queue body + marker
  -> native worker
  -> overlay result

Build
  -> explicit ordered source list
  -> deterministic generated root files
  -> stale-output/version/default validation
```

There are no new manager classes, repository objects, one-implementation
interfaces, event buses, factories, or compatibility adapters.

## Findings: confirmed, insignificant, and deferred

| Hypothesis | Result |
| --- | --- |
| Runtime assembly depends on numeric/glob order | Confirmed and fixed with an explicit validated source list. The generated script still intentionally shares one scope. |
| `00_context_state_paths.js` owns broad mutable state | Confirmed. Lifecycle ownership already lives mainly in `60`; moving all declarations would create a high-risk whole-runtime migration, so the remaining contract is documented. |
| Overlay and Settings mix many responsibilities | Confirmed. Their 44 and 36 listener sites and large source sizes remain; no unmeasured DOM rewrite was attempted. |
| Settings/version metadata drift | Confirmed. Plugin version generation and all duplicated default checks now fail the build on disagreement; targeted runtime effects have one table. |
| Manifest parse failure silently loses apparent state | Confirmed and fixed with corrupt-byte preservation and backup recovery. |
| Repeated manifest reads are a material hot-path cost | A later plugin-wide benchmark demonstrated a 4.97 ms active-dictionary scan. Active paths now use a five-second cache that is invalidated on manifest writes, media loads, and Settings refreshes, while other reads still consult the authoritative on-disk manifest. |
| Worker can observe partial JavaScript JSON | Confirmed by an intermittent benchmark failure and fixed by body-plus-marker publication. |
| Worker idle scan rate is unnecessarily high | Confirmed and reduced with active/idle backoff. |
| Lookup/geometry contention requires another process | Not demonstrated by the available fixtures. The single-request worker model remains documented and no deployment split was added. |
| Native helper is one undivided implementation | Partly outdated at HEAD: protocol parsing, media demux, and ASS geometry already have focused translation units. The remaining CLI/lookup/worker unit was not split without an independent ownership or performance gain. |
| Production ships substantial tests | Confirmed; 493 lines were removed from the generated runtime while standalone coverage was retained. |
| Dictionary metadata needs another cache | Not demonstrated at expected dictionary counts, so no cache was added. |
| Generated language rules need runtime optimisation | A broader six-language benchmark later exposed French deinflection at 9.64 ms per request. Rules are now indexed by applicable affix while preserving original rule order and outputs. |
| Broad empty catches hide important failures | Confirmed for profile/global preference writes and fixed there. Capability probes around optional IINA/mpv APIs remain intentionally best-effort. |

The pass inspected language routing/deinflection, dictionary formatting,
Settings, Anki/media, audio, overlay lifecycle, native geometry, packaging, and
licensing paths through their existing focused suites. No change was made merely
because a component was large.

## State ownership before and after

| Concern | Before | After |
| --- | --- | --- |
| Manifest/profile data | Disk helpers silently returned empty state on parse errors | `20_dictionary_manifest.js` owns schema, staging, recovery, corrupt preservation, and profile transitions; disk remains authoritative |
| Setting runtime effects | Repeated key arrays in transition planning | One static key-to-effect table in `15_profile_settings.js` |
| Worker request commit | Both callers directly wrote watched JSON | Two callers share direct publication/cleanup helpers in `30_backend_import_worker_lookup.js` |
| Overlay bridge routing | One long conditional chain plus raw aliases | One validated handler table in `50_overlay_bridge_pause.js` |
| Cache limits | Per-cache or absent implicit policy | Existing owners retain their caches; shared insertion gives explicit bounds where needed |
| Overlay lifecycle | Existing desired/effective/readiness controller | Preserved; its snapshot is included in the redacted runtime diagnostics |

Existing generation/request identities for overlay lifecycle, worker start/stop,
native geometry, hover lookup, Settings Anki refresh, and popup Anki requests
were retained rather than replaced. Media capture and import flows keep their
current owners and cleanup tests.

## Major deletions and consolidation

- Removed 493 lines of parser/settings unit checks, lookup benchmarking, and
  task-panel test code from the shipped menu runtime. Equivalent automated
  tests and the worker performance fixture remain under `tests/`.
- Renamed the reduced `70_menu.js` to reflect its actual ownership.
- Replaced the overlay bridge's repeated type condition chain with one
  11-handler table and direct dispatch. The six undocumented raw popup aliases
  were removed because the in-repository overlay sends JSON.
- Kept worker request publication as two direct helpers beside their two
  callers. The proposed factory, lazy protocol instance, and separate fragment
  were deleted during review.
- Kept cache bounding as one seven-line insertion helper used by lookup,
  external SRT, and Anki caches; no cache manager or new cache was introduced.
- Removed the proposed manifest snapshot/repository state. Reads now consult the
  one authoritative on-disk manifest; verified staging, backup recovery, and
  corrupt-byte preservation remain direct functions in the manifest owner.
- Removed per-fragment banners from generated output. The explicit short build
  manifest still enforces order and completeness without adding generated
  runtime bulk.
- Consolidated setting-to-runtime-effect decisions in one static table. The
  proposed derived schema framework was removed; focused existing normalisers
  remain the clearer and smaller path.
- Preference write/sync failures are no longer swallowed by empty catches.
- The Debug menu now writes one concise redacted snapshot containing lifecycle,
  active profile/language, worker counters, queue/cache sizes, timer activity,
  and bridge connection count. It excludes subtitle text and media paths.

No baseline top-level mutable declarations or caches were removed. The
temporary manifest/protocol state added earlier in the pass was removed before
the final result and therefore is not counted as a baseline reduction.

## Reliability and security changes

### Manifest persistence

- Every written manifest carries `schemaVersion: 1`.
- Writes are encoded to `manifest.json.next`, parsed back, written to the main
  path, parsed again, and followed by a last-known-good backup.
- Parse failures preserve the corrupt bytes and recover a valid backup instead
  of silently returning empty user data.
- Commit failures propagate to the caller and staged files are cleaned up.
- IINA's plugin file API exposes no rename operation, so this is accurately a
  verified staged write plus recovery copy, not a claimed POSIX-atomic rename.

### Filesystem worker protocol

- JavaScript writes a complete ignored `.request` body before publishing the
  watched `.json` marker. Cleanup removes both.
- The native worker accepts the existing complete-JSON path for native clients,
  caps request bodies at 4 MiB, and checks open/read/write/flush failures.
- Request IDs are limited to 128 ASCII alphanumeric, hyphen, or underscore
  characters. A payload ID must match its filename, preventing response path
  redirection.
- The configured short interval is used while active; empty-queue polling backs
  off exponentially to 16 ms. The default idle scan ceiling drops from about
  500 to 62.5 scans per second.

### Other boundaries

- Audio resolver requests allow only HTTP/HTTPS for initial and redirect
  protocols, cap responses at 4 MiB, and retain the eight-second timeout.
- Unknown or malformed overlay bridge messages are logged and ignored.
- `Info.json` owns the plugin release version. Build validation checks
  `package.json`, `ghVersion`, generated JavaScript, and all 50 preference
  defaults against it.
- Explicit zero Anki sentence-audio padding is preserved instead of being
  replaced by the default.

## Cache and polling policy

| Cache | Bound / expiry |
| --- | --- |
| Lookup results, including no-result | 256 FIFO entries |
| Overlay audio URLs | 32 FIFO entries |
| Native font metrics | 32 FIFO entries |
| Native ASS geometry | 16 FIFO entries (pre-existing) |
| External SRT parses | 4 FIFO entries |
| Anki model fields | 32 FIFO entries |
| Passive Anki duplicate status | 80 entries, 5 s TTL (pre-existing) |
| AnkiConnect version | one entry, 30 s TTL (pre-existing) |
| Active dictionary paths | one entry, 5 s TTL; invalidated by manifest writes, media loads, and Settings refreshes |

The original audit added no cache and bounded five existing caches; the later
performance sweep added the active-dictionary cache shown above. Subtitle
polling remains because IINA/mpv property events are not sufficient for every
subtitle transition; the native worker's unnecessary idle work was reduced
instead.

## Measurements and validation

Baseline full tests took 22.61 seconds through an opaque shell chain. The new
runner reports each suite, supports groups/exclusions, enforces a timeout, and
prints all failures; the final run passed 31/31 suites in 21.70 seconds.

| Build/package measure | Baseline | After |
| --- | ---: | ---: |
| Direct generated-file build | 0.12 s | 0.05 s |
| Plugin packaging | 1.26 s | 0.44 s |
| Plugin package | 2,001,131 bytes | about 2.007 MB, including this audit |
| Native helper binary | 4,265,744 bytes | 4,265,888 bytes |
| Native incremental build | 4.31 s, four wrapper units | 2.34 s, one changed unit; not directly comparable |

The worker fixture initially reproduced the direct-publication race as
intermittent `invalid JSON at byte 0` responses. Two consecutive 424-request
body-plus-marker runs completed with zero failed requests:

| Fixture | Baseline | Repeated after |
| --- | ---: | ---: |
| Japanese lookup | median 5 ms, p95 25 ms | median 3 ms, p95 5-6 ms |
| Prefix lookup | median 2 ms, p95 7 ms | median 3 ms, p95 6-7 ms |
| Simulated overlay-to-render | median 6 ms, p95 21 ms | median 8 ms, p95 20-22 ms |

The demonstrated gains are publication reliability and lower idle wake-up
frequency, not a claim that dictionary execution itself became faster.

Release validation, package creation, package validation, formatting, generated
syntax checks, and native ASS geometry tests all pass. Real WebView render
latency, startup-to-ready, long-session RSS/energy, and click-through behaviour
cannot be measured faithfully by Node fixtures.

The full test harness peak memory footprint was about 25.9 MB at baseline and
26.1 MB after. This includes spawned Node/native test processes and is not a
long-session plugin RSS measurement, so the small difference is treated as
noise. Bounded-cache growth is deterministic from the policy table above.

Automatic CI now runs on pushes and pull requests with read-only repository
permissions, npm caching, Prettier, generated/version/default checks, portable
JavaScript suites, syntax checks, and packaging metadata validation. The
existing manually triggered Apple Silicon workflow still performs native
release construction and now uses the same generated-file check. A broad
ESLint/clang-tidy rollout was deliberately omitted until IINA globals and the
native dependency warning baseline can be configured without noisy failures.

## Necessary new abstractions

- `MAIN_RUNTIME_PARTS` and `OVERLAY_RUNTIME_PARTS`: explicit build data replacing
  implicit glob order; validation proves every source is declared exactly once.
- `PROFILE_PREFERENCE_RUNTIME_EFFECTS`: a static table replacing repeated
  setting lists in runtime transition planning.
- `OVERLAY_BRIDGE_HANDLERS`: a direct lookup table replacing a long repeated
  conditional chain.
- `putBoundedCache`: seven lines shared by several existing object caches.
- `publishWorkerRequest`/`cleanupWorkerRequest`: direct helpers shared by the two
  queue request paths so commit ordering cannot drift.

Each either deletes duplication, provides one clear owner, or enforces a tested
boundary. None adds a new long-lived object or parallel source of truth.

## Remaining redundancy and risk

- `overlay.js` remains about 220 KB and mixes rendering, interaction, placement,
  audio, and Anki UI. Event delegation could reduce its 44 listener sites, but
  changing subtitle/popup hit behaviour without manual IINA validation was too
  risky for this pass.
- Settings remains one roughly 67 KB HTML source with 36 listener sites.
- The `iina.window-loaded` handler and `core.window.loaded` fallback are two
  startup entry paths. The fallback was retained for host timing compatibility.
- `40_legacy_line_precompute.js` has a legacy filename but contains the active
  lookup request handler; it was not deleted or renamed to avoid an unrelated
  source-order migration.
- Native clients may still publish a complete `.json` request. That path is
  retained because the packaged helper's client command is an external CLI
  boundary, not merely an internal JavaScript API.
- Wildcard network permission remains necessary for user-configured dictionary
  and audio sources; validation stays at execution/open boundaries.
- A complete settings metadata generator, overlay/Settings source split,
  generated-language provenance tooling, event delegation, and low-noise
  ESLint/clang-tidy baselines remain deliberate follow-up projects rather than
  partial migrations in this pass.

## Manual IINA validation still required

No real IINA manual session was performed in this environment. The following
host-specific compatibility checks therefore remain required before release:

- Persisted Shift+H enablement and repeated overlay enable/disable.
- Primary/secondary SRT and ASS surfaces, resize, theme, and click-through.
- Popup hover, safe corridor, wheel trapping, audio menu, and source links.
- Settings profile/import/reorder flows in the standalone WebView.
- Anki duplicate status, card creation, screenshot/audio, and cleanup.
- Corrupt-manifest recovery against a real plugin data directory.
- Long playback memory and Activity Monitor energy/wake-up sampling.
