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