import { NextResponse, type NextRequest } from "next/server";
import { signInWithInvitationLink } from "@/features/organizations/invitation-link";

/*
 * Continue on /invite/{token} (D-28). The token is never echoed into a
 * redirect or a log line. 303, so the browser follows with a GET.
 */
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const next = await signInWithInvitationLink(String(form.get("token") ?? ""));
  return NextResponse.redirect(new URL(next, request.url), 303);
}
