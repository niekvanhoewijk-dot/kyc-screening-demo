import { eq } from "drizzle-orm";
import { documents } from "@/db/schema";
import { portalDeps } from "@/portal/deps";
import { currentAnalyst } from "../../analyst-session";

// Serves an uploaded (synthetic) document to the console. Demo: requires a chosen analyst, not real auth.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await currentAnalyst())) return new Response("Choose an analyst first", { status: 403 });
  const { id } = await params;
  const deps = portalDeps();
  const doc = deps.db.select().from(documents).where(eq(documents.id, id)).get();
  if (!doc) return new Response("Not found", { status: 404 });
  const bytes = await deps.files.read(doc.storedPath);
  return new Response(new Uint8Array(bytes), {
    headers: { "Content-Type": doc.mime, "Cache-Control": "private, no-store", "Content-Disposition": `inline; filename="${doc.kind}-${doc.id}"` },
  });
}
