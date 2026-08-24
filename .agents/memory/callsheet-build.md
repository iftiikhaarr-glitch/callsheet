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