# PGLearn

Read and follow the shared project instructions in AGENTS.md. Then read README.md, spec/01-decisions.md, HANDOFF.md and the current task in tasks.json before implementation. These files are the common source of truth for both coding agents. Record task status and test evidence there; do not create a competing plan or duplicate business rules in this file.

## Host application

This directory is both the PG Labs marketing site and the PGLearn application. `app/(marketing)/` is the public site; `app/(platform)/` is PGLearn. Route-group names in parentheses do not appear in URLs, so the paths in `spec/04-ui.md` are accurate as written.

Two defaults differ from specification v1.0 and are recorded with reasons in HANDOFF.md: the repository layout (D-01, adapts ADR-01 — root `app/`, not `src/app/`) and the design system (D-02, overrides ADR-16 — PG Labs `design-system-v2`, not slate/indigo). Everything in spec/02, spec/03, spec/05 and `contracts/` applies verbatim.

Do not regress the marketing routes while implementing PGLearn. `npm run build` must keep prerendering them as static.
