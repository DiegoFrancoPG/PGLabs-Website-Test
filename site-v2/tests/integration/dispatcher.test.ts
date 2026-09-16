import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { hasDatabase, withClient } from "./db";

/*
 * ADR-03 requires a literal allowlist, so the dispatcher has to be recreated by
 * every migration that adds actions. That is easy to get wrong in one specific
 * way: writing a handler and forgetting to register it, which leaves an
 * operation silently unreachable and indistinguishable from one that does not
 * exist.
 *
 * These read the live database rather than the migration files, so they check
 * what is actually deployed.
 */
describe.skipIf(!hasDatabase)("pglearn_rpc allowlist", () => {
  it("reaches every handler that exists", async () => {
    await withClient(async (client) => {
      const handlers = await client.query(
        `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname='app' AND p.proname LIKE 'handle\\_%' ORDER BY 1`
      );
      const dispatcher = await client.query(
        "SELECT prosrc FROM pg_proc WHERE proname='pglearn_rpc'"
      );
      const source: string = dispatcher.rows[0].prosrc;

      const unreachable = handlers.rows
        .map((r) => r.proname as string)
        .filter((name) => !source.includes(`app.${name}(actor, payload)`));

      expect(unreachable).toEqual([]);
    });
  });

  it("dispatches only actions whose handler exists", async () => {
    await withClient(async (client) => {
      const dispatcher = await client.query(
        "SELECT prosrc FROM pg_proc WHERE proname='pglearn_rpc'"
      );
      const actions = [...(dispatcher.rows[0].prosrc as string).matchAll(/WHEN '([a-z_]+)'/g)].map(
        (m) => m[1]
      );
      const handlers = await client.query(
        `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname='app' AND p.proname LIKE 'handle\\_%'`
      );
      const known = new Set(handlers.rows.map((r) => `handle_${""}${(r.proname as string).slice(7)}`));
      for (const action of actions) expect(known.has(`handle_${action}`)).toBe(true);
    });
  });

  it("only dispatches operation ids the contract declares", async () => {
    const api = JSON.parse(
      readFileSync(path.join(__dirname, "../../contracts/api.json"), "utf8")
    );
    const declared = new Set<string>();
    for (const methods of Object.values(api.paths as Record<string, Record<string, { operationId?: string }>>)) {
      for (const op of Object.values(methods)) if (op?.operationId) declared.add(op.operationId);
    }

    await withClient(async (client) => {
      const dispatcher = await client.query(
        "SELECT prosrc FROM pg_proc WHERE proname='pglearn_rpc'"
      );
      const actions = [...(dispatcher.rows[0].prosrc as string).matchAll(/WHEN '([a-z_]+)'/g)].map(
        (m) => m[1]
      );
      // An action with no operationId would be a capability the contract does
      // not describe, which spec/01 makes authoritative.
      const undeclared = actions.filter((a) => !declared.has(a));
      expect(undeclared).toEqual([]);
    });
  });
});
