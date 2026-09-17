import { authorizeDownload, downloadRequestSchema } from "@/features/content/assets";
import { mutateRoute } from "@/lib/route";

/*
 * operationId authorize_download.
 *
 * A POST that deliberately mints a fresh URL every time. spec/05: "Generated
 * asset URLs are refreshed after reauthorization, not treated as immutable
 * cached signatures" — so nothing here consults an idempotency cache.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ asset_id: string }> }) {
  const { asset_id } = await params;
  return mutateRoute(request, downloadRequestSchema, ({ body }) =>
    authorizeDownload(asset_id, body)
  );
}
