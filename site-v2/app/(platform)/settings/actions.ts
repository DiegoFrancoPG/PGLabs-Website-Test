"use server";

import { revalidatePath } from "next/cache";
import { updateMe, profilePatchSchema } from "@/features/identity/me";
import { RpcError } from "@/lib/rpc";

export interface SettingsState {
  status: "idle" | "saved" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
}

/*
 * spec/04 /settings: "Dirty-form save; invalid timezone inline; role/email
 * never editable here."
 *
 * Only the three permitted fields are read out of the form at all, so a field
 * injected into the DOM never reaches the service. The service rejects unknown
 * keys as well, and so does the RPC — three independent refusals.
 */
export async function saveSettings(
  _state: SettingsState,
  formData: FormData
): Promise<SettingsState> {
  const patch = {
    display_name: String(formData.get("display_name") ?? ""),
    timezone: String(formData.get("timezone") ?? ""),
    reminders_enabled: formData.get("reminders_enabled") === "on",
  };

  const parsed = profilePatchSchema.safeParse(patch);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[issue.path.join(".") || "form"] = issue.message;
    }
    return { status: "error", message: "Check the highlighted fields.", fieldErrors };
  }

  try {
    await updateMe(parsed.data);
  } catch (err) {
    if (err instanceof RpcError && err.code === "VALIDATION_ERROR") {
      return {
        status: "error",
        message: "That timezone is not recognised.",
        fieldErrors: { timezone: "Choose a timezone from the list." },
      };
    }
    console.error("[settings] save failed", err);
    return { status: "error", message: "Your changes were not saved. Try again." };
  }

  revalidatePath("/settings");
  // spec/04: success is shown only after the server acknowledges.
  return { status: "saved", message: "Your settings have been saved." };
}
