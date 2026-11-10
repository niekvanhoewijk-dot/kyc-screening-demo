import { SAMPLE_SLOTS, sampleFile, type SampleSlot } from "@/demo/prefill";
import { getCurrentCase } from "@/portal/cases";
import { portalDeps } from "@/portal/deps";
import { currentApplicant } from "../../session";

export const dynamic = "force-dynamic";

// Demo Mode (docs/spec/11): previews the sample file a screen says it attached. Only for a signed-in
// applicant while Demo Mode is on; the files are the synthetic SAMPLE fixtures.
export async function GET(_: Request, { params }: { params: Promise<{ slot: string }> }) {
  const { slot } = await params;
  const applicant = await currentApplicant();
  if (!applicant || !(SAMPLE_SLOTS as readonly string[]).includes(slot)) return new Response(null, { status: 404 });
  const deps = portalDeps();
  const file = sampleFile(deps, getCurrentCase(deps, applicant.id), slot as SampleSlot);
  if (!file) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(file.bytes), { headers: { "content-type": file.type, "cache-control": "no-store" } });
}
