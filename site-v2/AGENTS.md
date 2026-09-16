# PGLearn implementation instructions

Read README.md, spec/01-decisions.md and HANDOFF.md first. Then read the current task in tasks.json and its referenced contracts/scenarios. User instructions override this package. Do not reinterpret historical planning notes as newer decisions.

- Work in dependency order. Record the active task before changing application code. Complete one coherent task and its checks before handing it off.
- Keep contracts and code consistent. Change a contract deliberately, record why, and update affected scenarios and callers in the same task. Do not independently redesign auth, schema, API envelopes or provider adapters.
- Current decisions are implementation defaults. Resolve routine details within them; ask only for necessary missing inputs or a consequential product decision. Never ask for credentials in committed files or logs.
- All business writes go through validated transactional handlers. Identity comes from verified session/auth.uid(); all user IDs/organization IDs in input are selectors, never authority.
- Raw app tables and service credentials are private. Organization managers cannot see personal enrollments, exercise response bodies or tutor chats. No UI-only authorization.
- Use real persistence. Test doubles must be explicit and isolated; real-integration checks remain pending until exercised. Never add production bypasses to satisfy a demo.
- Preserve existing work and use the existing dependency lockfile. Do not run two writers against the same checkout. If parallel work is explicitly requested, use separate branches/worktrees with agreed task/file ownership.
- Run meaningful checks for changed rules and boundary cases. A task is done only when required acceptance IDs have passing evidence. Record unavailable-provider checks as blocked, not passed.
- Task completion evidence must state files/commit, commands, outcomes and limitations. Update tasks.json and HANDOFF.md before ending or transferring work. Avoid placing private learner content in evidence.
- Specification validation command: `python3 verify_spec.py`. T01 must establish application scripts: `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:integration`, `npm run test:e2e`, `npm run build` and `npm run db:reset:test`. Do not claim these scripts exist before T01 implements them.
- Do not mark the overall demo/pilot gate complete because individual UI pages render. Follow the explicit gate tasks.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
