import type { Metadata } from "next";
import { AuthCard } from "@/components/pglearn/AuthCard";
import { Button } from "@/components/pglearn/ui/button";
import { CONFIRM_TYPES, safeNext } from "@/lib/auth-links";

export const metadata: Metadata = { title: "Continue to PGLearn" };

/*
 * Where an emailed sign-in link lands (D-27). Mail scanners open links to
 * check them; if this page spent the one-time token on that visit, the person
 * would find their link already used. So it spends nothing: Continue posts the
 * token to /auth/verify, which a scanner does not press.
 */
export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string; next?: string }>;
}) {
  const { token_hash: tokenHash, type, next } = await searchParams;
  const valid = Boolean(tokenHash) && CONFIRM_TYPES.includes(type as (typeof CONFIRM_TYPES)[number]);

  return (
    <AuthCard>
      <h1 className="text-center font-heading text-ui-title text-ui-foreground">
        {valid ? "Continue to PGLearn" : "This link is not valid"}
      </h1>
      {valid ? (
        <form method="post" action="/auth/verify" className="mt-8 flex flex-col gap-5">
          <input type="hidden" name="token_hash" value={tokenHash} />
          <input type="hidden" name="type" value={type} />
          <input type="hidden" name="next" value={safeNext(next)} />
          <p className="text-center text-ui-body text-ui-muted-foreground">
            Press Continue to open your invitation. The link works once.
          </p>
          <Button type="submit" variant="primary" className="w-full">
            Continue
          </Button>
        </form>
      ) : (
        <p className="mt-4 text-center text-ui-body text-ui-muted-foreground">
          Ask whoever invited you to send the invitation again.
        </p>
      )}
    </AuthCard>
  );
}
