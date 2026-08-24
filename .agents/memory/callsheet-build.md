---
name: Callsheet build
description: Product and implementation constraints for the Callsheet screenplay breakdown app.
---

Callsheet is an information-dense production tool for assistant directors. The primary user value is the fast path from a bundled screenplay to a searchable, editable scene breakdown; preserve that path when replacing the sample backend with real PDF and Gemini processing.

**Why:** The initial build prioritizes a trustworthy end-to-end workflow and explicit scene correction over a decorative demo.

**How to apply:** Keep scene categories industry-oriented and keep synopsis/elements visibly editable in the breakdown workspace.

Gemini model availability should be verified against the live API before shipping. The configured direct Gemini API rejected `gemini-2.5-flash` for new users and instructed use of `gemini-3.6-flash`.

**Why:** Gemini model availability can change independently of SDK releases and documented defaults.

**How to apply:** Keep the model identifier in the Python worker aligned with the API's explicit migration response, then run a small screenplay upload before claiming the breakdown path works.

Uploaded screenplay bytes, results, and worker failures must survive service restarts. Store the PDF in private App Storage, record its key plus the project/scenes/error in PostgreSQL, and allow `/process` to re-run the saved source when no replacement file is supplied.

**Why:** Multer memory and temporary worker files are erased at request completion; in-memory project data is erased at restart, which makes failed uploaded scripts impossible to diagnose or retry.

**How to apply:** Persist the source before invoking the worker. On failure, retain the exact worker message with a failed project state; in the workspace, offer a re-run action that reads the persisted source.

Shooting schedules are deterministic scene-derived plans with a Gemini explanation saved alongside the project. Treat schedule edits as stale whenever scene content or cast tags change, rather than regenerating on every tab visit.

**Why:** Repeating an AI rationale can create inconsistent production guidance and unnecessary API calls; a schedule must reflect the editable breakdown that produced it.

**How to apply:** Invalidate the saved plan after a scene change, then rebuild it only when the schedule view is requested. Day Out of Days statuses are screenplay-only estimates: Work on assigned days; gaps between calls are Hold at one location or Travel when locations differ; other days are Off.

Schedule grouping uses the physical base location, not the exact slug-line location, and reconciles cast aliases where one name is a subset of another. Keep `RELAY TOWER - PLATFORM` with `RELAY TOWER`, and use the fuller character name when `MARA` and `MARA VOSS` both occur.

**Why:** Screenplays often distinguish set areas or use shortened character names, but production scheduling needs one location block and one cast row per real person.

**How to apply:** Strip sublocation suffixes, canonicalize descriptive aliases to the shared base when token subsets match, and merge a first-name cast tag into its unambiguous longer-name counterpart before computing location groups, cast overlap, or Day Out of Days.

Production-risk findings belong to the saved schedule, but a risk-analysis failure must never replace or revive a schedule invalidated by a scene edit. Export reports should always read the latest saved scene data rather than relying on client-side state.

**Why:** A schedule is production guidance, so stale AI flags are worse than missing flags; exports need to reflect the corrected breakdown the user has saved.

**How to apply:** Guard risk-result and risk-error persistence with the project version that produced the request, retry from current data after a conflict, validate every Gemini scene reference against the supplied scene list, and generate PDF/CSV output server-side from persisted scenes.

Production-risk analysis combines Gemini's script-specific review with deterministic findings for directly tagged stunts, exterior night/dusk schedule blocks, and multi-day pickup-truck use. Treat saved results as versioned analysis so stronger grounding rules refresh old flags.

**Why:** The model can under-report obvious tagged production risks; reliable breakdown warnings must surface the evidence the schedule already proves, while retaining AI findings for less predictable issues.

**How to apply:** Keep the deterministic findings tied to actual scene numbers and their schedule days, deduplicate overlapping Gemini categories, and bump the risk-analysis version when the grounded rules materially change.

Reportlab paragraph content must escape screenplay/user text before rendering; inline formatting should be added only through a dedicated helper after dynamic values are escaped.

**Why:** Passing markup through the generic escaping helper prints tags literally, while leaving dynamic screenplay text unescaped can corrupt report layout or interpret user content as formatting.

**How to apply:** Keep the generic PDF paragraph helper fully escaped, construct approved labels such as bold section prefixes separately, and scan generated PDFs for literal tags when changing report markup.