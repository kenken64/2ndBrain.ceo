import { handleZoomIntegration } from "@/lib/zoom-integration";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(request: Request, context: { params: Promise<{ action: string }> }) {
  return handleZoomIntegration(request, (await context.params).action);
}
export { handle as GET, handle as POST };
