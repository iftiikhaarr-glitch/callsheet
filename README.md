# Callsheet — AI Script Breakdown & Shooting Schedule

Callsheet turns a screenplay PDF into a production-ready breakdown and an
optimized shooting schedule in minutes — automating the days of prep a
1st Assistant Director normally does by hand.

## What it does
- **Scene breakdown:** Parses a screenplay PDF and uses Google Gemini to tag
  every scene with cast, props, wardrobe, vehicles, stunts, VFX, SFX, and
  day/night + INT/EXT.
- **Optimized shooting schedule:** Groups same-location scenes into efficient
  shoot days, builds a standard Day Out of Days grid, and reports days saved
  versus shooting in script order.
- **Production risk flags:** Surfaces budget and safety risks (night exteriors,
  stunts, vehicle continuity) with specific scene references and recommendations.
- **Export:** Produces a producer-ready PDF report and a CSV breakdown.

## Tech stack
- **AI:** Google Gemini via the `google-genai` SDK
- **Built & deployed on:** Replit (built with Replit Agent, deployed on Replit)
- **Backend:** Python / Flask, PostgreSQL
- **Frontend:** TypeScript / React

## Live app
https://callsheet-app.replit.app

## Hackathon
Built for the Agentic Cinema: The Blockbuster Hackathon — Replit track.
Powered by Google Cloud + Replit.

## License
MIT — see LICENSE.
