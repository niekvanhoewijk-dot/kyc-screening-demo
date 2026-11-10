import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cardFor } from "@/agent/interviewer";
import { ApplicantShell } from "@/components/applicant-shell";
import { ArrowIcon } from "@/components/icons";
import { env } from "@/lib/env";
import { getCurrentCase, stepCase } from "@/portal/cases";
import { portalDeps } from "@/portal/deps";
import { resumeStep, stepPath } from "@/portal/steps";
import { startWalletAction } from "../actions";
import { identityFormProps, residenceFormProps } from "../_forms/props";
import { IdentityForm, ResidenceForm } from "../_forms/step-forms";
import { currentApplicant } from "../session";
import { InterviewChat } from "./chat";

export const dynamic = "force-dynamic";

/** Demo helper (?script=<id>): the scripted applicant's lines, so a replay demo sends exactly the recorded text. */
function scriptLines(id: string | undefined): string[] | undefined {
  if (!id || !/^[a-z0-9-]+$/.test(id)) return undefined;
  const file = path.resolve(/* turbopackIgnore: true */ process.cwd(), "fixtures/interviews", `${id}.json`);
  if (!fs.existsSync(file)) return undefined;
  const steps = (JSON.parse(fs.readFileSync(file, "utf8")) as { steps: { say?: string }[] }).steps;
  return steps.flatMap((s) => (s.say ? [s.say] : []));
}

// The interviewer (docs/spec/10 section 7). The disclosure and the exit to the form are rendered by the page, not the model.
export default async function InterviewPage({ searchParams }: { searchParams: Promise<{ script?: string }> }) {
  if (!env.AGENT_ENABLED) notFound();
  const applicant = await currentApplicant();
  if (!applicant) redirect("/apply/continue");
  const deps = portalDeps();
  const c = getCurrentCase(deps, applicant.id);
  const sc = stepCase(c);
  if (c.persona !== "individual" || c.overviewSeenAt === null) redirect(stepPath(resumeStep(sc)));

  const cfg = deps.agent.interviewer;
  const resume = resumeStep(sc);
  const card = cardFor(deps, c);
  const lines = scriptLines((await searchParams).script);

  return (
    <ApplicantShell
      panelTitle="Answer with an assistant"
      panelBody="An AI assistant asks the application questions in a chat and saves your answers for you to check. The secure steps stay on our own pages."
      c={sc}
      current={resume === "check" ? "check" : resume}
      eyebrow="AI assistant"
      title="Your application, in a chat"
    >
      <div className="banner" role="note">
        <strong>{cfg.disclosure}</strong>{" "}
        <Link href={stepPath(resume)} className="link">
          Continue with the form instead
        </Link>
      </div>

      <InterviewChat storageKey={`interview:${c.id}`} greeting={cfg.greeting} maxChars={cfg.max_message_chars} scriptLines={lines} />

      {card?.kind === "identity" && (
        <section className="stack panel-soft" aria-labelledby="card-identity">
          <span className="eyebrow">Secure step</span>
          <h2 id="card-identity" className="section-title">Proof of identity</h2>
          <p className="hint">This form goes straight to us, not to the assistant. You come back to the chat when it is done.</p>
          <form action={startWalletAction} className="actions">
            <input type="hidden" name="returnTo" value="interview" />
            <button className="btn" type="submit">Use my ID wallet <ArrowIcon /></button>
          </form>
          <p className="hint">Or upload a photo of your ID and take a selfie:</p>
          <IdentityForm {...identityFormProps(deps, c)} returnTo />
        </section>
      )}
      {card?.kind === "residence" && (
        <section className="stack panel-soft" aria-labelledby="card-residence">
          <span className="eyebrow">Secure step</span>
          <h2 id="card-residence" className="section-title">Proof of residence</h2>
          <p className="hint">This form goes straight to us, not to the assistant. You come back to the chat when it is done.</p>
          <ResidenceForm {...residenceFormProps(deps, c).form} returnTo />
        </section>
      )}
      {(card?.kind === "review" || card?.kind === "submit") && (
        <section className="stack panel-soft" aria-labelledby="card-next">
          <span className="eyebrow">Secure step</span>
          <h2 id="card-next" className="section-title">{card.kind === "review" ? "Check your answers" : "Submit your application"}</h2>
          <p className="hint">
            {card.kind === "review"
              ? "Check every answer the assistant saved, change anything that is not right, and tick the declaration yourself."
              : "Your answers are confirmed. You submit the application yourself on the next page."}
          </p>
          <div className="actions">
            <Link href={card.href} className="btn">
              {card.kind === "review" ? "Open the review page" : "Go to submit"} <ArrowIcon />
            </Link>
          </div>
        </section>
      )}
    </ApplicantShell>
  );
}
