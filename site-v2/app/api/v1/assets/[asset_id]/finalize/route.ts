import { finalizeUpload, finalizeSchema, type Asset } from "@/features/content/assets";
import { callRpc } from "@/lib/rpc";
import { mutateRoute } from "@/lib/route";

/*
 * operationId finalize_upload.
 *
 * Two calls to the same action: the first reads back what was reserved, the
 * second records the verdict. The declared facts are never taken from the
 * request, because spec/03 has finalization compare the stored object against
 * what was reserved — trusting the caller for both sides would check nothing.
 */
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ asset_id: string }> }
) {
  const { asset_id } = await params;

  return mutateRoute(request, finalizeSchema, async ({ body }) => {
    const reserved = (await callRpc("finalize_upload", {
      asset_id,
      inspect: true,
    })) as { asset: Asset; storage_key: string; duration_ms: number | null };

    return finalizeUpload(
      asset_id,
      {
        role: reserved.asset.role,
        mimeType: reserved.asset.mime_type,
        declaredBytes: Number(reserved.asset.bytes),
        storagePath: reserved.storage_key,
        durationMs: reserved.duration_ms,
      },
      body
    );
  });
}
