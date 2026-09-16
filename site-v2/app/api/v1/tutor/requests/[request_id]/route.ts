import { getTutorRequest } from "@/features/tutor/tutor";
import { readRoute } from "@/lib/route";

/*
 * operationId get_tutor_request.
 *
 * What a pending request is polled with. spec/05: "Polling reads never consume
 * question quota" — this takes no rate window and reserves nothing.
 */
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ request_id: string }> }
) {
  const { request_id } = await params;
  return readRoute(request, () => getTutorRequest(request_id));
}
