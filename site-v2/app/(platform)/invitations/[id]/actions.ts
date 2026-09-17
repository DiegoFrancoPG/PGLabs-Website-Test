"use server";

import { redirect } from "next/navigation";
import { acceptInvitation } from "@/features/identity/invitations";
import { RpcError } from "@/lib/rpc";

export async function accept(_state: { error?: string }, formData: FormData) {
  const id = String(formData.get("invitation_id") ?? "");
  try {
    await acceptInvitation(id);
  } catch (err) {
    if (err instanceof RpcError && err.code === "NOT_FOUND") {
      // Same message whether the invitation is missing or belongs to someone
      // else — spec/05 uses 404 for both, deliberately.
      return { error: "That invitation is not available for this account." };
    }
    if (err instanceof RpcError && err.code === "CONFLICT") {
      return { error: "That invitation has expired or is no longer available." };
    }
    console.error("[invitations] accept failed", err);
    return { error: "The invitation could not be accepted. Try again." };
  }
  redirect("/learn");
}
