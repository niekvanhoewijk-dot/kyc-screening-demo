"use server";

import { revalidatePath } from "next/cache";
import { resetDemo } from "@/demo/seed";
import { portalDeps } from "@/portal/deps";
import type { FormState } from "../../apply/form-state";
import { currentAnalyst } from "../analyst-session";

export async function resetDemoAction(_: FormState, fd: FormData): Promise<FormState> {
  const analyst = await currentAnalyst();
  if (!analyst) return { message: "Choose who you are first." };
  if (String(fd.get("confirm") ?? "").trim() !== "RESET") return { message: "Type RESET to confirm.", fieldErrors: { confirm: ["Type RESET to confirm"] } };
  const r = await resetDemo(portalDeps(), { claude: "auto", actor: analyst.id });
  revalidatePath("/", "layout");
  return { ok: true, message: `Demo reset: ${r.cases.length} synthetic cases seeded. ${r.claude.note}` };
}
