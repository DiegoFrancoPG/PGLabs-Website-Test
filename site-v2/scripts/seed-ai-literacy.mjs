#!/usr/bin/env node
/*
 * The AI Literacy nine-video series, authored into PGLearn.
 *
 * Source: ai-literacy-program-structure.md, section 5 (Format B). The titles,
 * the three parts and the description of each video are taken from that
 * document; nothing here invents curriculum.
 *
 * Every step goes through the REAL routes, signed in as a real person: create
 * the program, open its draft, add modules and classes, authorize each upload,
 * put the bytes in storage, finalize so the server inspects what actually
 * arrived, publish, grant, assign. Seeding by writing rows directly would prove
 * nothing about whether the platform works.
 *
 *   node scripts/seed-ai-literacy.mjs          # author, publish and assign
 *   node scripts/seed-ai-literacy.mjs --clean  # remove it again
 *
 * Needs a server running (npm run dev) and the fixture accounts.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import pg from "pg";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLEAN = process.argv.includes("--clean");

const PROGRAM_TITLE = "AI Literacy Training — Nine-Video Series";
const COHORT_NAME = "NSCSS pilot";
const VIDEO = path.join(root, "test-video.mp4");

/* ------------------------------------------------------------------- env */

function env() {
  const out = {};
  for (const raw of readFileSync(path.join(root, ".env.local"), "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [key, ...rest] = line.split("=");
    out[key.trim()] = rest.join("=").trim();
  }
  return out;
}
const config = { ...env(), ...process.env };
const value = (key) => config[key] ?? "";

/*
 * This script is for a development or test database and nothing else.
 *
 * It signs in as fixture accounts with a shared password, reads organization
 * and learner ids out of tests/fixtures.json, and uploads test-video.mp4 nine
 * times. None of that exists or belongs on a deployed environment.
 *
 * The sharp edge is --clean: it deletes enrollments, class progress, playback
 * sessions, exercise completions and CERTIFICATES for any programme matching
 * PROGRAM_TITLE. Once the real series has been authored into production under
 * that same title, a --clean run there would destroy real learners' records of
 * having completed it. Every other operator script in this directory refuses a
 * deployed target; this one did not.
 */
const appEnv = value("APP_ENV") || "development";
if (appEnv !== "development" && appEnv !== "test") {
  console.error(
    `seed-ai-literacy: APP_ENV is "${appEnv}". This seeds fixture content and deletes learner ` +
      "records, and only runs against development or test.\n" +
      "  To author this series on a deployed environment, use the admin UI with the real videos.\n" +
      "  The curriculum text is in PARTS below and in ai-literacy-program-structure.md."
  );
  process.exit(1);
}
/*
 * The app's own origin, not an equivalent one. proxy.ts refuses a mutation
 * whose Origin does not match NEXT_PUBLIC_APP_URL — that is ADR-06 working, and
 * 127.0.0.1 is a different origin from localhost as far as a browser and that
 * rule are concerned.
 */
const BASE = value("PGLEARN_BASE_URL") || value("NEXT_PUBLIC_APP_URL") || "http://localhost:3001";

function databaseUrl() {
  if (value("SUPABASE_DB_URL")) return value("SUPABASE_DB_URL");
  const ref = new URL(value("NEXT_PUBLIC_SUPABASE_URL")).hostname.split(".")[0];
  return `postgresql://postgres:${encodeURIComponent(
    value("SUPABASE_DB_PASSWORD")
  )}@db.${ref}.supabase.co:5432/postgres`;
}

/* --------------------------------------------------------------- content */

/*
 * The nine videos, from section 5 of the structure document. `runtime` is what
 * that document specifies; `source_text` is the description the tutor will
 * retrieve from, drawn from the same section.
 */
const PARTS = [
  {
    title: "Part 1 — Understanding",
    summary: "What AI is, where it already shows up, and what it is good and bad at.",
    videos: [
      {
        title: "1. What AI actually is",
        runtime: "10:15",
        source_text:
          "Artificial intelligence as used at work is prediction, not knowledge. A large language " +
          "model predicts the next word from patterns in what it has read; it does not look " +
          "anything up and it does not know whether what it produces is true. This video carries " +
          "the map of the whole series and acknowledges the environmental cost of running these " +
          "models, which video 3 then answers with figures. Register: confessional, direct " +
          "address, fully reusable across organizations.",
      },
      {
        title: "2. Where it already is",
        runtime: "10:00 + 3:00 tail",
        source_text:
          "AI is already inside software people use without choosing it: search results, email " +
          "suggestions, meeting transcription, document summaries, translation, spam filtering. " +
          "A narrated walkthrough of an ordinary shift, pointing at each place it appears. The " +
          "organization-specific tail names the tools actually approved here and what the staff " +
          "survey found people already using, including anything adopted without asking.",
      },
      {
        title: "3. Good at, bad at, honest numbers",
        runtime: "10:00",
        source_text:
          "What these tools are genuinely good at: drafting, rephrasing, summarizing, " +
          "translating, changing the register of something already written. What they are bad " +
          "at: being right. A hallucination is a confident, fluent, entirely invented answer, " +
          "and it looks exactly like a correct one. The honest numbers on cost: roughly 0.24 to " +
          "0.34 watt-hours of electricity per short query, and roughly 10 to 50 millilitres of " +
          "water per medium response, with estimates varying widely between studies.",
      },
    ],
  },
  {
    title: "Part 2 — The Rules",
    summary: "Three concrete rules applicable the same day.",
    videos: [
      {
        title: "4. Boundaries: red, amber, green",
        runtime: "10:00–10:15 + 1:00 tail",
        source_text:
          "The traffic-light rule. Green: work you would be comfortable posting publicly — " +
          "drafting generic text, rephrasing your own writing, brainstorming. Amber: proceed " +
          "with care and a human review before anything leaves the building. Red: stop, do not " +
          "use AI at all. The ten-second check asks what category this is before anything is " +
          "typed. This video stands alone for staff who will not watch all nine, and it builds " +
          "the reference card on screen. The tail names this organization's own red-list items " +
          "with a one-line reason for each.",
      },
      {
        title: "5. Data, PII and where text goes",
        runtime: "10:00 + 1:00 tail",
        source_text:
          "Follow the data. Anything typed into a consumer AI tool leaves the organization and " +
          "may be retained or used for training. Personal information means names, contact " +
          "details, dates of birth, case details, health information, immigration status — " +
          "anything that identifies a person or could when combined with something else. Under " +
          "BC PIPA, personal information collected for one purpose cannot be sent somewhere else " +
          "without a basis. The never-enter list is the rule: what never gets typed in, at all, " +
          "in any tool. The tail states the account tier in use here and what it permits.",
      },
      {
        title: "6. Bias and the fixed limit",
        runtime: "10:00",
        source_text:
          "These systems learn from human decisions, including discriminatory ones, and they " +
          "reproduce that pattern at speed and at scale while sounding neutral. The fixed limit " +
          "follows: AI never decides anything about a person's safety, their job, their legal " +
          "standing or their financial standing. It may draft, it may summarize, it may " +
          "suggest — a person decides, and that person is accountable for the decision. The " +
          "human-in-the-loop diagram is shared with the Core Standard module: draft, review, " +
          "you approve. The slowest video in the series, deliberately.",
      },
    ],
  },
  {
    title: "Part 3 — Judgment in Practice",
    summary: "The calls no rule can make for you, rehearsed before they happen.",
    videos: [
      {
        title: "7. Disclosure and access",
        runtime: "7:00–7:30",
        source_text:
          "When to say that AI was involved, and to whom. Disclosure is about the people " +
          "affected by the work rather than about the tool. The access half: these tools are not " +
          "equally usable by everyone, and assuming they are builds an unequal service. " +
          "Deliberately the shortest video in the series — a breather after video 6.",
      },
      {
        title: "8. Six situations",
        runtime: "10:00",
        source_text:
          "Six situations most likely to come up, each rehearsed before it happens rather than " +
          "decided under pressure: a draft that needs to go out today, a client detail that " +
          "would make the prompt work better, a summary of something you did not read, a tool a " +
          "colleague swears by that nobody approved, a decision that would be quicker if the " +
          "model just made it, and a piece of output that sounds right and cannot be checked. " +
          "An anthology, the fastest cutting rate in the series, and it stands alone.",
      },
      {
        title: "9. FASTER and sign-off",
        runtime: "9:30–10:00",
        source_text:
          "FASTER, from the Treasury Board of Canada Secretariat: Fair, Accountable, Secure, " +
          "Transparent, Educated, Relevant. Each letter maps back to the video that taught it — " +
          "Accountable to video 6, Secure to video 5, Transparent to video 7, Educated to video " +
          "3. The close carries the reference card: where the training materials live, where the " +
          "anonymous question channel is, and who to ask.",
      },
    ],
  },
];

/*
 * A caption track for each class.
 *
 * It says what it is. The recorded narration does not exist yet — these are
 * placeholder cues over a placeholder video, and a caption that pretended
 * otherwise would be worse than none, because captions are what a deaf learner
 * reads instead of listening.
 */
function captionFor(title) {
  return [
    "1",
    "00:00:00,000 --> 00:00:05,000",
    `${title} — placeholder caption track.`,
    "",
    "2",
    "00:00:05,000 --> 00:00:10,000",
    "The recorded narration for this class has not been produced yet.",
    "",
    "3",
    "00:00:10,000 --> 00:00:14,000",
    "This track stands in so the class can be published in the test environment.",
    "",
  ].join("\n");
}

/** The real length of test-video.mp4, read from its mvhd atom. */
function videoDurationMs() {
  const data = readFileSync(VIDEO);
  let pos = 0;
  while (pos < data.length - 8) {
    const size = data.readUInt32BE(pos);
    const type = data.toString("latin1", pos + 4, pos + 8);
    if (type === "moov") {
      const moov = data.subarray(pos + 8, pos + size);
      const at = moov.indexOf("mvhd");
      const version = moov[at + 4];
      const timescale = version === 0 ? moov.readUInt32BE(at + 16) : moov.readUInt32BE(at + 24);
      const duration =
        version === 0 ? moov.readUInt32BE(at + 20) : Number(moov.readBigUInt64BE(at + 28));
      return Math.round((duration / timescale) * 1000);
    }
    if (size < 8) break;
    pos += size;
  }
  throw new Error("could not read the video's duration");
}

/* ----------------------------------------------------------------- doing */

/*
 * The Origin is sent explicitly: a browser attaches one, and page.request does
 * not. proxy.ts refuses a mutation without a matching Origin, which is the rule
 * working rather than getting in the way.
 */
const idempotent = () => ({
  "Content-Type": "application/json",
  Origin: BASE,
  "Idempotency-Key": crypto.randomUUID(),
});

/*
 * A fresh context per person.
 *
 * /login redirects away when there is already a session, so signing the manager
 * in on the administrator's context finds no form at all. Two people, two
 * browsers — which is also how it happens in life.
 */
async function asPerson(browser, email) {
  const context = await browser.newContext({ baseURL: BASE });
  const page = await context.newPage();
  await signIn(page, email);
  return { context, page };
}

async function signIn(page, email) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(value("PGLEARN_TEST_PASSWORD"));
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/learn", { timeout: 30_000 });
}

/** A call through the application's own API, as the signed-in person. */
async function api(page, method, url, data) {
  const response = await page.request[method](`${BASE}${url}`, {
    headers: idempotent(),
    ...(data === undefined ? {} : { data }),
  });
  const text = await response.text();
  if (!response.ok()) throw new Error(`${method.toUpperCase()} ${url} → ${response.status()} ${text}`);
  return JSON.parse(text).data;
}

/** Authorize, put the bytes in storage, then let the server inspect them. */
async function upload(page, classId, role, name, mime, body) {
  const authorized = await api(page, "post", "/api/v1/assets/uploads", {
    class_id: classId,
    role,
    original_name: name,
    mime_type: mime,
    bytes: body.length,
  });

  // Straight to storage, and deliberately without our headers: this request
  // does not go to the application at all.
  const put = await page.request.fetch(authorized.upload_url, {
    method: "PUT",
    headers: { "Content-Type": mime, "x-upsert": "true" },
    data: body,
  });
  if (!put.ok()) throw new Error(`storage refused ${name}: ${put.status()} ${await put.text()}`);

  return api(page, "post", `/api/v1/assets/${authorized.asset.id}/finalize`, {});
}

/*
 * Teardown.
 *
 * It does NOT delete the published version's content, because the platform
 * forbids that — published content is read-only and a published version cannot
 * return to draft, enforced by triggers that caught an earlier version of this
 * script trying. Those triggers are protecting real course material from
 * exactly this kind of deletion, and suspending them to get a tidier test
 * database would be trading a real guarantee for a cosmetic one.
 *
 * So this does what the product itself does: cancels the assignment, empties
 * the cohort, and ARCHIVES the programme, which is how a platform administrator
 * retires a course. For a genuinely empty database there is `npm run
 * db:reset:test`, which is the sanctioned way and rebuilds the fixtures.
 */
async function clean() {
  const client = new pg.Client({
    connectionString: databaseUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const program = (
      await client.query("SELECT id, archived_at FROM app.programs WHERE title = $1", [
        PROGRAM_TITLE,
      ])
    ).rows[0];
    if (!program) {
      console.log("nothing to clean: the programme is not there");
      return;
    }

    await client.query("BEGIN");
    // A learner's own rows are not course content, so these can go.
    const scope = `(SELECT id FROM app.enrollments WHERE program_id = '${program.id}')`;
    await client.query(`DELETE FROM app.learning_events WHERE enrollment_id IN ${scope}`);
    await client.query(`DELETE FROM app.class_progress WHERE enrollment_id IN ${scope}`);
    await client.query(`DELETE FROM app.playback_sessions WHERE enrollment_id IN ${scope}`);
    await client.query(`DELETE FROM app.exercise_completions WHERE enrollment_id IN ${scope}`);
    await client.query(`DELETE FROM app.certificates WHERE enrollment_id IN ${scope}`);
    await client.query(`DELETE FROM app.notification_outbox WHERE enrollment_id IN ${scope}`);
    await client.query("DELETE FROM app.enrollments WHERE program_id = $1", [program.id]);
    await client.query("DELETE FROM app.cohort_offerings WHERE program_id = $1", [program.id]);
    await client.query("DELETE FROM app.program_grants WHERE program_id = $1", [program.id]);
    await client.query(
      `DELETE FROM app.cohort_members WHERE cohort_id IN (SELECT id FROM app.cohorts WHERE name = $1)`,
      [COHORT_NAME]
    );
    await client.query("DELETE FROM app.cohorts WHERE name = $1", [COHORT_NAME]);
    await client.query("UPDATE app.programs SET archived_at = now() WHERE id = $1", [program.id]);
    await client.query("COMMIT");

    console.log("assignment cancelled, cohort removed, programme archived");
    console.log("Its published content stays: published content is read-only, by design.");
    console.log("For an empty database: npm run db:reset:test");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

async function main() {
  if (CLEAN) return clean();
  if (!existsSync(VIDEO)) throw new Error(`${VIDEO} is not there`);

  const durationMs = videoDurationMs();
  const video = readFileSync(VIDEO);
  const fixtures = JSON.parse(readFileSync(path.join(root, "tests/fixtures.json"), "utf8")).ids;
  console.log(`test-video.mp4 is ${(durationMs / 1000).toFixed(2)}s, ${video.length} bytes`);

  const browser = await chromium.launch();
  const admin = await asPerson(browser, "admin@example.invalid");
  const page = admin.page;

  try {
    console.log("signed in as the administrator");

    /*
     * A second run reuses what is there rather than making a second programme
     * with the same name. Published content cannot be rewritten anyway, so
     * authoring is skipped and the run goes straight to granting and assigning.
     */
    const catalog = await api(page, "get", "/api/v1/programs");
    const already = (catalog.items ?? catalog).find((entry) => entry.title === PROGRAM_TITLE);

    let program;
    let version;
    if (already) {
      program = already;
      version = { id: already.latest_published_version_id };
      if (!version.id) {
        throw new Error(
          `"${PROGRAM_TITLE}" exists (${already.id}) but has no published version. ` +
            "Finish it in the admin screens, or run --clean."
        );
      }
      console.log(`reusing the published programme ${program.id}`);
    } else {
      program = null;
    }

    if (!program?.id || !version?.id) {
    const created = await api(page, "post", "/api/v1/programs", {
      title: PROGRAM_TITLE,
      summary:
        "Nine short videos in three parts: what AI is, the three rules that apply the same day, " +
        "and the judgment calls no rule can make for you. Assembled from the program structure " +
        "document of 16 September 2026. No assessment, by design.",
    });
    /*
     * create_program answers with the programme AND its first draft version:
     * a programme with no version is not something an author can do anything
     * with, so the two are made together.
     */
    program = created.program;
    version = created.version;
    console.log(`program ${program.id}, draft version ${version.id}`);

    let position = 0;
    for (const part of PARTS) {
      const created_module = await api(page, "post", `/api/v1/versions/${version.id}/modules`, {
        title: part.title,
        position,
      });
      console.log(`  ${part.title}`);
      position += 1;

      let classPosition = 0;
      for (const item of part.videos) {
        const created = await api(page, "post", `/api/v1/modules/${created_module.id}/classes`, {
          title: item.title,
          kind: "video",
          required: true,
          position: classPosition,
          body_md:
            `*${part.summary}*\n\n` +
            `Intended runtime in the script: **${item.runtime}**. The media attached here is ` +
            `a ${(durationMs / 1000).toFixed(0)}-second placeholder.`,
          source_text: item.source_text,
          duration_ms: durationMs,
        });
        classPosition += 1;

        await upload(page, created.id, "primary", "test-video.mp4", "video/mp4", video);
        await upload(
          page,
          created.id,
          "caption",
          "captions.srt",
          "application/x-subrip",
          Buffer.from(captionFor(item.title), "utf8")
        );
        console.log(`    ${item.title} — video and captions ready`);
      }
    }

    const published = await api(page, "post", `/api/v1/versions/${version.id}/publish`, {});
    if (published.issues?.length) {
      console.error("publication refused:");
      for (const issue of published.issues) console.error(`  ${issue.path}: ${issue.message}`);
      throw new Error("the draft is not publishable");
    }
    console.log("published");
    }

    if (already?.archived) {
      await api(page, "patch", `/api/v1/programs/${program.id}`, { archived: false });
      console.log("un-archived it");
    }

    const grant = await api(page, "post", "/api/v1/grants", {
      program_id: program.id,
      organization_id: fixtures.org_a,
      user_id: null,
      starts_at: new Date(Date.now() - 86_400_000).toISOString(),
      ends_at: null,
    });
    console.log(`granted to Demo Organization A (${grant.id})`);

    /* ---- the manager assigns it ---- */
    const manager = await asPerson(browser, "manager_a@example.invalid");
    console.log("signed in as the manager");

    const cohort = await api(manager.page, "post", "/api/v1/cohorts", {
      organization_id: fixtures.org_a,
      name: COHORT_NAME,
    });
    const learners = [fixtures.amber, fixtures.ben];
    await api(manager.page, "post", `/api/v1/cohorts/${cohort.id}/members`, { user_ids: learners });

    const offering = await api(manager.page, "post", "/api/v1/offerings", {
      cohort_id: cohort.id,
      version_id: version.id,
      grant_id: grant.id,
      starts_at: new Date(Date.now() - 3_600_000).toISOString(),
      due_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      access_ends_at: null,
    });
    const enrolled = await api(manager.page, "post", `/api/v1/offerings/${offering.id}/enrollments`, {
      user_ids: learners,
    });

    console.log(`assigned to "${COHORT_NAME}": ${enrolled.created} enrolled`);
    console.log("");
    console.log("Sign in as amber@example.invalid to see it at /learn");
    console.log(`Admin view: ${BASE}/admin/programs/${program.id}`);
    console.log(`Manager view: ${BASE}/manage/${fixtures.org_a}/cohorts/${cohort.id}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
