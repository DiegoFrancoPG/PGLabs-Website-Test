"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { VersionDetail } from "@/features/content/content";
import { ClassEditor } from "@/components/admin/ClassEditor";
import { Alert } from "@ds/components/ui/alert";
import { Button } from "@ds/components/ui/button";
import { Card } from "@ds/components/ui/card";

/*
 * The draft, and everything that can be done to it.
 *
 * spec/04 asks for: version title and description, add module and class,
 * up/down reorder, per-class format/required/body/duration, the file picker,
 * source and captions, exercise instructions, and Publish — with publication
 * listing what is missing per class rather than refusing with one message.
 */

/*
 * Every mutation carries an Idempotency-Key, without exception: lib/route.ts
 * requires one on every non-GET, and a helper that made it optional is how
 * three of these calls shipped without it.
 */
async function send(path: string, method: string, body: unknown) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Idempotency-Key": crypto.randomUUID(),
  };
  const response = await fetch(path, { method, headers, body: JSON.stringify(body ?? {}) });
  const json = await response.json();
  if (!response.ok) {
    const error = new Error(json?.error?.message ?? "It could not be saved.") as Error & {
      fields?: { path: string; message: string }[];
      code?: string;
    };
    error.fields = json?.error?.fields;
    error.code = json?.error?.code;
    throw error;
  }
  return json.data;
}

export function VersionEditor({
  detail,
  readOnly,
}: {
  detail: VersionDetail;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(detail.version.title);
  const [description, setDescription] = useState(detail.version.description_md);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<{ path: string; message: string }[]>([]);
  const [busy, setBusy] = useState(false);

  const modules = [...detail.modules].sort((a, b) => a.position - b.position);
  const classesFor = (moduleId: string) =>
    detail.classes.filter((c) => c.module_id === moduleId).sort((a, b) => a.position - b.position);

  async function act(what: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await what();
      setStatus(done);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    setBusy(true);
    setError(null);
    setStatus(null);
    setIssues([]);
    try {
      await send(`/api/v1/versions/${detail.version.id}/publish`, "POST", {});
      setStatus("Published. This version is now read-only.");
      router.refresh();
    } catch (err) {
      const failure = err as Error & { fields?: { path: string; message: string }[]; code?: string };
      // spec/04: "publication lists missing fields per class". Every problem at
      // once, so an author fixes them in one pass rather than one per attempt.
      if (failure.code === "PUBLISH_INCOMPLETE" && failure.fields?.length) {
        setIssues(failure.fields);
      } else {
        setError(failure.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-8">
      {/* aria-live so a save or a failure is announced, not only shown. */}
      <div role="status" aria-live="polite" className="sr-only">
        {status ?? ""}
      </div>

      <section>
        <h2 className="text-label uppercase text-ink-700">This version</h2>
        <Card className="mt-3 p-5">
          <label htmlFor="version-title" className="block text-label uppercase text-steel-500">
            Title
          </label>
          <input
            id="version-title"
            value={title}
            disabled={readOnly}
            maxLength={160}
            onChange={(event) => setTitle(event.target.value)}
            className="mt-1 w-full rounded-lg border border-steel-300 p-2 text-body-sm disabled:bg-mist-100"
          />

          <label
            htmlFor="version-description"
            className="mt-4 block text-label uppercase text-steel-500"
          >
            Description
          </label>
          {/* spec/04: textarea plus preview, and no rich-text editor this release. */}
          <textarea
            id="version-description"
            rows={4}
            value={description}
            disabled={readOnly}
            maxLength={20000}
            onChange={(event) => setDescription(event.target.value)}
            className="mt-1 w-full rounded-lg border border-steel-300 p-2 text-body-sm disabled:bg-mist-100"
          />

          {!readOnly && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-4"
              disabled={busy}
              onClick={() =>
                act(
                  () =>
                    send(`/api/v1/versions/${detail.version.id}`, "PATCH", {
                      title,
                      description_md: description,
                    }),
                  "Saved."
                )
              }
            >
              Save
            </Button>
          )}
        </Card>
      </section>

      <section className="mt-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-label uppercase text-ink-700">Modules and classes</h2>
          {!readOnly && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                act(
                  () =>
                    send(
                      `/api/v1/versions/${detail.version.id}/modules`,
                      "POST",
                      { title: `Module ${modules.length + 1}` }
                    ),
                  "Module added."
                )
              }
            >
              Add module
            </Button>
          )}
        </div>

        {modules.length === 0 ? (
          <Card className="mt-3 p-6">
            <p className="text-body-sm">
              This version has no modules yet. A version needs at least one module with one
              required class before it can be published.
            </p>
          </Card>
        ) : (
          <div className="mt-3 flex flex-col gap-5">
            {modules.map((module, index) => (
              <Card key={module.id} className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-display text-h5 text-ink-800">{module.title}</h3>
                  {!readOnly && (
                    <div className="flex gap-2">
                      {/* spec/04 asks for up/down reorder rather than drag, which
                          is keyboard-operable by construction. */}
                      <Button
                        type="button"
                        variant="subtle"
                        size="sm"
                        aria-label={`Move ${module.title} up`}
                        disabled={busy || index === 0}
                        onClick={() =>
                          act(
                            () =>
                              send("/api/v1/content/reorder", "POST", {
                                version_id: detail.version.id,
                                modules: swap(
                                  modules.map((m) => m.id),
                                  index,
                                  index - 1
                                ).map((id, position) => ({ id, position })),
                              }),
                            "Reordered."
                          )
                        }
                      >
                        ↑
                      </Button>
                      <Button
                        type="button"
                        variant="subtle"
                        size="sm"
                        aria-label={`Move ${module.title} down`}
                        disabled={busy || index === modules.length - 1}
                        onClick={() =>
                          act(
                            () =>
                              send("/api/v1/content/reorder", "POST", {
                                version_id: detail.version.id,
                                modules: swap(
                                  modules.map((m) => m.id),
                                  index,
                                  index + 1
                                ).map((id, position) => ({ id, position })),
                              }),
                            "Reordered."
                          )
                        }
                      >
                        ↓
                      </Button>
                    </div>
                  )}
                </div>

                <div className="mt-4 flex flex-col gap-3">
                  {classesFor(module.id).map((cls) => (
                    <ClassEditor
                      key={cls.id}
                      cls={cls}
                      exercise={detail.exercises.find((e) => e.class_id === cls.id) ?? null}
                      assets={detail.assets.filter((a) => a.class_id === cls.id)}
                      readOnly={readOnly}
                    />
                  ))}
                  {classesFor(module.id).length === 0 && (
                    <p className="text-body-sm text-steel-500">No classes in this module yet.</p>
                  )}
                </div>

                {!readOnly && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-4"
                    disabled={busy}
                    onClick={() =>
                      act(
                        () =>
                          send(
                            `/api/v1/modules/${module.id}/classes`,
                            "POST",
                            {
                              title: `Class ${classesFor(module.id).length + 1}`,
                              kind: "text",
                              required: true,
                            }
                          ),
                        "Class added."
                      )
                    }
                  >
                    Add class
                  </Button>
                )}
              </Card>
            ))}
          </div>
        )}
      </section>

      {!readOnly && (
        <section className="mt-12 border-t border-steel-200 pt-8">
          <h2 className="font-display text-h4 text-ink-800">Publish</h2>
          <p className="mt-2 text-body-sm text-steel-500">
            Publishing makes this version read-only and available to assign. Learners already on an
            earlier version stay on it. This cannot be undone.
          </p>

          {issues.length > 0 && (
            <Alert variant="warning" className="mt-4" role="alert">
              <p className="font-semibold">This version cannot be published yet:</p>
              <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
                {issues.map((issue) => (
                  <li key={`${issue.path}-${issue.message}`}>
                    <span className="text-steel-500">{issue.path}</span> — {issue.message}
                  </li>
                ))}
              </ul>
            </Alert>
          )}

          <Button type="button" variant="primary" className="mt-5" disabled={busy} onClick={publish}>
            {busy ? "Working…" : "Publish this version"}
          </Button>
        </section>
      )}

      {status && (
        <Alert variant="info" className="mt-6">
          {status}
        </Alert>
      )}
      {error && (
        <Alert variant="warning" className="mt-6" role="alert">
          {error}
        </Alert>
      )}
    </div>
  );
}

/** Returns the list with two positions exchanged. */
function swap<T>(items: T[], from: number, to: number): T[] {
  const copy = [...items];
  const held = copy[from];
  copy[from] = copy[to];
  copy[to] = held;
  return copy;
}
