# 06 — Sources and verification boundaries

Primary documentation checked 15 September 2026. Contract-specific decisions are ours; provider documentation supports integration behavior. Patch versions are resolved and locked once at T01.

- [Next.js installation](https://nextjs.org/docs/app/getting-started/installation): framework/runtime setup; verify installed patch compatibility during bootstrap.
- [Supabase SSR clients](https://supabase.com/docs/guides/auth/server-side/creating-a-client): cookie/session clients and server identity checks.
- [Supabase database functions](https://supabase.com/docs/guides/database/functions): function security and execute privileges.
- [Supabase storage uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads): direct/resumable file handling; adapter uses installed SDK’s supported signed-upload flow.
- [Vercel cron](https://vercel.com/docs/cron-jobs): scheduled HTTP GET invocation.
- [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys): duplicate protection lasts 24 hours.
- [OpenAI model configuration](https://developers.openai.com/api/docs/models/gpt-5-mini): configured alias capabilities/rates; deprecated snapshot is not selected.
- [OpenAI structured output](https://developers.openai.com/api/docs/guides/structured-outputs): JSON schema output and handling invalid/refused responses.
- [Codex AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md): repository instruction discovery. Keep shared instructions short and link detailed specs.
- [Claude Code project memory](https://code.claude.com/docs/en/memory): CLAUDE.md project guidance. The provided CLAUDE.md explicitly points to the shared instructions, avoiding duplicated rules.

The package does not include API credentials, actual videos, transcripts, real organization information or a running application. Specification validation and reference-DDL tests are documented separately in VALIDATION.md. All application tasks and real-integration acceptance gates begin unverified.
