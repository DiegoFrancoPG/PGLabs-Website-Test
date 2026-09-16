"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "@ds/components/ui/alert";
import { Badge } from "@ds/components/ui/badge";
import { Button } from "@ds/components/ui/button";
import type { TutorAnswer } from "@/features/tutor/tutor";

/*
 * The tutor drawer (spec/04).
 *
 * "Tutor drawer exposes 'Explain this' and 'Give me a practical example'
 * suggestions, question input, send action, pending indicator, validated answer
 * and course source links. Mark examples 'Illustrative example.' Show
 * unsupported answer gracefully and provider failure with a manual retry
 * choice. Do not block class navigation/completion while waiting for tutor. Do
 * not auto-send again after timeout; inspect existing request state first."
 *
 * The last sentence is the one with teeth. A pending request is polled, never
 * re-sent: asking again after a timeout would spend a second question and may
 * cost money for an answer that is already on its way.
 */

const SUGGESTIONS = [
  { label: "Explain this", intent: "explanation" as const, question: "Explain this class in simple terms." },
  {
    label: "Give me a practical example",
    intent: "example" as const,
    question: "Give me a practical workplace example of this class.",
  },
];

const POLL_MS = 2_000;
const MAX_POLLS = 40; // Eighty seconds, past the 60-second server-side sweep.

export function TutorDrawer({
  enrollmentId,
  classId,
  className,
}: {
  enrollmentId: string;
  classId: string;
  className: string;
}) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [intent, setIntent] = useState<"explanation" | "example">("explanation");
  const [answers, setAnswers] = useState<TutorAnswer[]>([]);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const sessionId = useRef<string | null>(null);

  const record = useCallback((answer: TutorAnswer) => {
    setAnswers((current) => {
      const without = current.filter((a) => a.request_id !== answer.request_id);
      return [...without, answer];
    });
    sessionId.current = answer.session_id;
    setPendingId(answer.status === "pending" ? answer.request_id : null);
  }, []);

  /*
   * Polling, not re-sending. The request already exists on the server with its
   * own id; this only asks what became of it.
   */
  useEffect(() => {
    if (!pendingId) return;
    let polls = 0;
    const timer = setInterval(async () => {
      polls += 1;
      try {
        const response = await fetch(`/api/v1/tutor/requests/${pendingId}`);
        const json = await response.json();
        if (response.ok) record(json.data as TutorAnswer);
      } catch {
        // A failed poll is not a failed request. Keep polling.
      }
      if (polls >= MAX_POLLS) {
        setPendingId(null);
        setError("That question is taking longer than expected. Try asking again.");
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [pendingId, record]);

  async function send(text: string, asIntent: "explanation" | "example") {
    if (sending || pendingId) return;
    setSending(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/tutor/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          enrollment_id: enrollmentId,
          class_id: classId,
          session_id: sessionId.current,
          question: text,
          intent: asIntent,
        }),
      });
      const json = await response.json();

      if (!response.ok) {
        /*
         * 409 REQUEST_IN_PROGRESS is not an error to show as a failure — it
         * means an answer is already coming. Anything else is reported with a
         * retry the learner chooses to take.
         */
        if (json?.error?.code === "REQUEST_IN_PROGRESS") {
          setError("A question is already being answered. It will appear here.");
        } else {
          setError(json?.error?.message ?? "The tutor could not be reached.");
        }
        return;
      }

      record(json.data as TutorAnswer);
      setQuestion("");
    } catch {
      setError("The tutor could not be reached. Try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="mt-10 border-t border-steel-200 pt-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-h4 text-ink-800">Course tutor</h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-expanded={open}
          aria-controls="tutor-panel"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Hide tutor" : "Ask the tutor"}
        </Button>
      </div>

      {/*
        * Rendered but hidden rather than unmounted, so a pending question keeps
        * polling while the drawer is closed — spec/04: the tutor must not block
        * anything the learner does next.
        */}
      <div id="tutor-panel" hidden={!open} className="mt-5">
        <p className="text-body-sm text-steel-500">
          The tutor answers from this course only, and cannot mark anything complete.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          {SUGGESTIONS.map((suggestion) => (
            <Button
              key={suggestion.intent}
              type="button"
              variant="subtle"
              size="sm"
              disabled={sending || pendingId !== null}
              onClick={() => {
                setIntent(suggestion.intent);
                void send(`${suggestion.question} (${className})`, suggestion.intent);
              }}
            >
              {suggestion.label}
            </Button>
          ))}
        </div>

        <form
          className="mt-5"
          onSubmit={(event) => {
            event.preventDefault();
            void send(question, intent);
          }}
        >
          <label htmlFor="tutor-question" className="text-label uppercase text-ink-700">
            Your question
          </label>
          <textarea
            id="tutor-question"
            rows={3}
            maxLength={2000}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            className="mt-2 w-full rounded-lg border border-steel-300 p-3 text-body-sm"
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={sending || pendingId !== null || question.trim().length === 0}
            >
              {sending ? "Sending…" : "Ask"}
            </Button>
            <fieldset className="flex items-center gap-3 border-0 p-0">
              <legend className="sr-only">What kind of answer</legend>
              {SUGGESTIONS.map((suggestion) => (
                <label key={suggestion.intent} className="flex items-center gap-1 text-body-sm">
                  <input
                    type="radio"
                    name="intent"
                    value={suggestion.intent}
                    checked={intent === suggestion.intent}
                    onChange={() => setIntent(suggestion.intent)}
                  />
                  {suggestion.intent === "explanation" ? "Explanation" : "Example"}
                </label>
              ))}
            </fieldset>
          </div>
        </form>

        {/* The pending indicator, announced rather than only spun. */}
        {pendingId && (
          <p role="status" aria-live="polite" className="mt-4 text-body-sm text-steel-500">
            The tutor is answering…
          </p>
        )}

        {error && (
          <Alert variant="warning" className="mt-4" role="alert">
            {error}
          </Alert>
        )}

        <div className="mt-6 flex flex-col gap-5">
          {answers
            .filter((answer) => answer.status !== "pending")
            .map((answer) => (
              <Answer key={answer.request_id} answer={answer} onRetry={() => send(answer.question, intent)} />
            ))}
        </div>
      </div>
    </section>
  );
}

function Answer({ answer, onRetry }: { answer: TutorAnswer; onRetry: () => void }) {
  if (answer.status === "failed") {
    return (
      <div className="rounded-lg border border-steel-200 p-4">
        <p className="text-body-sm text-steel-500">{answer.question}</p>
        <Alert variant="warning" className="mt-3">
          The tutor could not answer that one.
        </Alert>
        {/* spec/04: "provider failure with a manual retry choice" — the learner
            chooses; nothing is re-sent on their behalf. */}
        <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-steel-200 p-4">
      <p className="text-body-sm text-steel-500">{answer.question}</p>

      {answer.mode === "example" && (
        <Badge variant="outline" className="mt-3">
          Illustrative example.
        </Badge>
      )}
      {answer.mode === "unsupported" && (
        <Badge variant="outline" className="mt-3">
          Outside this course
        </Badge>
      )}

      <p className="mt-3 whitespace-pre-wrap text-body-sm text-ink-800">{answer.answer}</p>

      {answer.citations.length > 0 && (
        <div className="mt-4">
          <h3 className="text-label uppercase text-steel-500">In the course</h3>
          <ul className="mt-2 flex flex-col gap-1">
            {answer.citations.map((citation) => (
              <li key={citation.source_id} className="text-body-sm">
                {/* The href was built by the server from ids it verified. */}
                <a href={citation.href} className="text-brand-600 underline underline-offset-4">
                  {citation.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
