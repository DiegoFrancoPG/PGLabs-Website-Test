#!/usr/bin/env node
/*
 * Operator-only storage provisioning for a fresh Supabase project.
 *
 * lib/storage.ts assumes SUPABASE_STORAGE_BUCKET already exists and is
 * private. Nothing in the application creates it, because an application that
 * could create its own bucket could also re-create it with the wrong
 * visibility after somebody had deliberately fixed it. So this is a command an
 * operator runs once per environment, and it is idempotent.
 *
 * What it guarantees, and why only these two things:
 *
 *   - public = false. Every read goes through a 15-minute signed URL issued
 *     after an authorization check (spec/02). A public bucket would make every
 *     asset readable by URL alone and silently bypass that check — it is the
 *     one setting that can turn the whole authorization boundary off.
 *   - fileSizeLimit = 1 GiB, the largest maxBytes in SUPPORTED_UPLOADS. The
 *     provider limit is a backstop under the server's own per-type limits,
 *     never a replacement for them.
 *
 * It deliberately does NOT set allowedMimeTypes. Browsers report no type for
 * .vtt and .srt files, so components/admin/UploadAsset.tsx sends
 * application/octet-stream for them; a bucket-level allowlist would reject
 * caption uploads that the server then validates correctly by extension and
 * content. The authoritative check is finalization, which inspects what the
 * object actually is rather than what the uploader claimed.
 *
 * Usage: node scripts/provision-storage.mjs [--yes]
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

function envLocal() {
  const file = path.join(root, ".env.local");
  if (!existsSync(file)) return {};
  const out = {};
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [key, ...rest] = line.split("=");
    out[key.trim()] = rest.join("=").trim();
  }
  return out;
}
const fileEnv = envLocal();
const value = (key) => process.env[key] ?? fileEnv[key] ?? "";

function fail(message) {
  console.error(`provision-storage: ${message}`);
  process.exit(1);
}

/*
 * A bucket's file size limit cannot exceed the PROJECT's global upload limit,
 * and the provider reports that as "The object exceeded the maximum allowed
 * size" while refusing the bucket write. It reads like a rejected file, so say
 * plainly what it actually is: the plan, not the request.
 */
function failOnSizeLimit(message) {
  if (!/exceeded the maximum allowed size/i.test(message)) return;
  fail(
    `the project will not accept a ${MAX_UPLOAD_BYTES}-byte bucket limit: ${message}\n` +
      "  A bucket limit cannot exceed the project's global upload limit\n" +
      "  (Dashboard -> Settings -> Storage -> Upload file size limit).\n" +
      "  The free plan caps that at 50 MiB and does not allow raising it, which is\n" +
      "  below the 1 GiB video uploads spec/03 supports. Move the project to a plan\n" +
      "  that permits it, raise the global limit, then re-run this command."
  );
}

/* The largest maxBytes in lib/storage.ts's SUPPORTED_UPLOADS. */
const MAX_UPLOAD_BYTES = 1_073_741_824;

const url = value("NEXT_PUBLIC_SUPABASE_URL");
const serviceKey = value("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !serviceKey) fail("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");

const name = value("SUPABASE_STORAGE_BUCKET") || "pglearn-private";
const ref = new URL(url).hostname.split(".")[0];
const appEnv = value("APP_ENV") || "development";

/*
 * This writes to whatever project the environment points at, and on a deployed
 * one that is the project holding real learner media. Name the target before
 * touching it, the way db-reset-test.mjs does, so a stale .env.local cannot
 * quietly aim this somewhere else.
 */
console.log(`Provisioning bucket "${name}" in project ${ref} (APP_ENV=${appEnv}).`);

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: existing, error: lookupError } = await supabase.storage.getBucket(name);

/*
 * getBucket reports a missing bucket as an error rather than empty data, so a
 * genuine failure — a bad key, an unreachable project — has to be told apart
 * from absence. Anything that is not a not-found is a real problem and stops
 * here rather than being treated as "create it".
 */
if (lookupError && !/not.?found/i.test(lookupError.message)) {
  fail(`could not read the bucket: ${lookupError.message}`);
}

if (!existing) {
  const { error } = await supabase.storage.createBucket(name, {
    public: false,
    fileSizeLimit: MAX_UPLOAD_BYTES,
  });
  if (error) {
    failOnSizeLimit(error.message);
    fail(`could not create the bucket: ${error.message}`);
  }
  console.log(`Created "${name}": private, ${MAX_UPLOAD_BYTES} byte limit.`);
  process.exit(0);
}

/*
 * It already exists. Report what is wrong with it and correct it, rather than
 * assuming a bucket with the right name has the right settings — the case this
 * command most needs to catch is a bucket somebody created by hand in the
 * dashboard, where public is the default in the UI.
 */
/*
 * The two corrections are applied SEPARATELY and privacy goes first. They fail
 * for unrelated reasons — a size limit can be refused by the project's plan,
 * which has nothing to do with visibility — and a combined write would let that
 * refusal leave a public bucket public. Privacy is the security property; it
 * must land even when the plan will not take the limit.
 */
let corrected = false;

if (existing.public) {
  console.log("  - it is PUBLIC — every asset is readable by URL alone");
  const { error } = await supabase.storage.updateBucket(name, { public: false });
  if (error) fail(`could not make the bucket private: ${error.message}`);
  console.log(`  -> "${name}" is now private.`);
  corrected = true;
}

if (Number(existing.file_size_limit ?? 0) !== MAX_UPLOAD_BYTES) {
  console.log(`  - its size limit is ${existing.file_size_limit ?? "unset"}, not ${MAX_UPLOAD_BYTES}`);
  const { error } = await supabase.storage.updateBucket(name, { fileSizeLimit: MAX_UPLOAD_BYTES });
  if (error) {
    failOnSizeLimit(error.message);
    fail(`could not set the bucket size limit: ${error.message}`);
  }
  console.log(`  -> "${name}" now accepts up to ${MAX_UPLOAD_BYTES} bytes.`);
  corrected = true;
}

if (!corrected) {
  console.log(`"${name}" already correct: private, ${MAX_UPLOAD_BYTES} byte limit. Nothing to do.`);
}
