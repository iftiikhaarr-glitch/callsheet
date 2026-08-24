# Callsheet

Callsheet turns screenplay scenes into an editable production breakdown for assistant directors.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm --filter @workspace/callsheet run dev` — run the Callsheet web app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 with a Python `google-genai` + `pdfplumber` screenplay worker
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/callsheet/src/pages/` — project entry and breakdown workspace
- `artifacts/callsheet/src/components/` — shared Callsheet shell and UI
- `artifacts/api-server/src/routes/projects.ts` — sample project, upload orchestration, scene breakdown, summaries, and edits
- `artifacts/api-server/breakdown_worker.py` — PDF text extraction, slug-line parsing, batched Gemini structured JSON analysis
- `lib/api-spec/openapi.yaml` — source of truth for project and scene APIs

## Architecture decisions

- The frontend uses generated API hooks so list, detail, sample-load, project edit, and scene edit all share the OpenAPI contract.
- The first build ships a deterministic bundled screenplay path alongside a real PDF/text upload path that uses Gemini structured output.
- PDF parsing is performed with `pdfplumber`; uploaded scenes are grouped into batches of five and processed concurrently before the API returns a ready project.
- Scene elements use a category-to-string-array map, matching the industry breakdown vocabulary while allowing future categories.

## Product

- Project list with sample screenplay loading and new-project metadata.
- Breakdown workspace with summary metrics, flagged scene review, search, location/type filters, and editable scene detail.
- Scene synopsis and tagged elements can be updated and persist through the API during the running session.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
