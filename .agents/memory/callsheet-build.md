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