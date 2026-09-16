"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@ds/components/ui/alert";
import { Button } from "@ds/components/ui/button";
import { countCodePoints, normalizeResponse, MAX_CODE_POINTS } from "@/lib/exercise";

/*
 * The short-response exercise (spec/04, AC-031 to AC-033).
 *
 * The first saved response is final in v1, so a saved one is shown as text
 * rather than in a field somebody could edit and fail to submit.
 *
 * The counter counts code points, the same way the API and the database do.
 * Counting `value.length` here would tell somebody with emoji in their answer
 * that they were over the limit when they were not.
 */
export function ExerciseForm({
  enrollmentId,
  exerciseId,
  instructions,
  saved,
}: {
  enrollmentId: string;
  exerciseId: string;
  instructions: string;
  saved: { response: string; confirmed_at: string } | null;
}) {
  const router = useRouter();
  const [response, setResponse] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key for the life of the form, so a retry is a retry and not a second answer.
  const [requestId] = useState(() => crypto.randomUUID());

  const used = countCodePoints(normalizeResponse(response));
  const tooLong = used > MAX_CODE_POINTS;

  if (saved) {
    return (
      <section className="mt-10 border-t border-steel-200 pt-8">
        <h2 className="font-display text-h4 text-ink-800">Practical exercise</h2>
        <p className="mt-3 whitespace-pre-wrap text-body-sm">{instructions}</p>
        <h3 className="mt-6 text-label uppercase text-ink-700">Your response</h3>
        <p className="mt-2 whitespace-pre-wrap rounded-lg bg-mist-100 p-4 text-body-sm">
          {saved.response}
        </p>
        <p className="mt-2 text-body-sm text-steel-500">
          Saved on {new Date(saved.confirmed_at).toLocaleDateString("en-CA")}. A response cannot be
          changed once it is saved.
        </p>
      </section>
    );
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/v1/enrollments/${enrollmentId}/exercises/${exerciseId}/completion`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": requestId },
          body: JSON.stringify({ response, confirmed: true }),
        }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "It could not be saved.");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="mt-10 border-t border-steel-200 pt-8">
      <h2 className="font-display text-h4 text-ink-800">Practical exercise</h2>
      <p className="mt-3 whitespace-pre-wrap text-body-sm">{instructions}</p>

      <form onSubmit={save} className="mt-6">
        <label htmlFor="exercise-response" className="text-label uppercase text-ink-700">
          Your response
        </label>
        <textarea
          id="exercise-response"
          name="response"
          rows={6}
          required
          value={response}
          onChange={(event) => setResponse(event.target.value)}
          aria-describedby="exercise-count"
          aria-invalid={tooLong}
          className="mt-2 w-full rounded-lg border border-steel-300 p-3 text-body-sm"
        />
        <p
          id="exercise-count"
          className={`mt-1 text-body-sm ${tooLong ? "text-coral-600" : "text-steel-500"}`}
        >
          {used} of {MAX_CODE_POINTS} characters
        </p>

        <label className="mt-4 flex items-start gap-2 text-body-sm">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            className="mt-1"
          />
          <span>I completed this exercise.</span>
        </label>

        <Button
          type="submit"
          variant="primary"
          className="mt-5"
          disabled={pending || tooLong || used === 0 || !confirmed}
        >
          {pending ? "Saving…" : "Save response"}
        </Button>

        {error && (
          <Alert variant="warning" className="mt-3">
            {error}
          </Alert>
        )}
      </form>
    </section>
  );
}
