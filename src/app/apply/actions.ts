"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { after } from "next/server";
import { getMode } from "@/console/mode";
import { runPreReview } from "@/documents/pre-review";
import { audit } from "@/lib/audit";
import { redirect } from "next/navigation";
import { createAccount, endSession, resendOtp, startSignIn, verifyOtp } from "@/portal/accounts";
import {
  getCurrentCase,
  markOverviewSeen,
  saveIdentity,
  saveQuestionnaire,
  saveResidence,
  stepCase,
  submitCase,
  type UploadInput,
} from "@/portal/cases";
import { portalDeps } from "@/portal/deps";
import { submitEdd } from "@/portal/edd";
import { confirmPersons, removePerson, saveCompany, saveCompanyDocuments, savePerson } from "@/portal/company";
import { PortalError } from "@/portal/errors";
import { nextStep, resumeStep, stepPath } from "@/portal/steps";
import type { FormState } from "./form-state";
import { cookieOptions, currentApplicant, PENDING_EMAIL_COOKIE, SESSION_COOKIE } from "./session";

const textValues = (fd: FormData) =>
  Object.fromEntries([...fd.entries()].filter(([k, v]) => typeof v === "string" && !k.startsWith("$")) as [string, string][]);

async function upload(fd: FormData, name: string): Promise<UploadInput | undefined> {
  const f = fd.get(name);
  if (!(f instanceof File) || f.size === 0) return undefined;
  return { name: f.name, type: f.type, size: f.size, bytes: Buffer.from(await f.arrayBuffer()) };
}

/** Turns an applicant-facing error into form state; anything else goes to the error boundary. */
function failed(e: unknown, fd: FormData): FormState {
  if (e instanceof PortalError) return { message: e.message, fieldErrors: e.fieldErrors, values: textValues(fd) };
  throw e;
}

async function signedInCase() {
  const applicant = await currentApplicant();
  if (!applicant) redirect("/apply/continue");
  const deps = portalDeps();
  return { deps, c: getCurrentCase(deps, applicant.id) };
}

async function goToResume() {
  const { c } = await signedInCase();
  redirect(stepPath(resumeStep(stepCase(c))));
}

async function rememberPendingEmail(email: string) {
  const ttl = portalDeps().portal.otp.ttl_minutes * 60;
  (await cookies()).set(PENDING_EMAIL_COOKIE, email, cookieOptions(ttl));
}

// 2.1.1
export async function createAccountAction(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const { email } = await createAccount(portalDeps(), textValues(fd));
    await rememberPendingEmail(email);
  } catch (e) {
    return failed(e, fd);
  }
  redirect("/apply/verify");
}

export async function signInAction(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const { email } = await startSignIn(portalDeps(), textValues(fd));
    await rememberPendingEmail(email);
  } catch (e) {
    return failed(e, fd);
  }
  redirect("/apply/verify");
}

// 2.1.2
export async function verifyOtpAction(_: FormState, fd: FormData): Promise<FormState> {
  const jar = await cookies();
  const email = jar.get(PENDING_EMAIL_COOKIE)?.value;
  if (!email) redirect("/apply/continue");
  try {
    const { sessionToken } = verifyOtp(portalDeps(), email, textValues(fd));
    jar.set(SESSION_COOKIE, sessionToken, cookieOptions(portalDeps().portal.session.ttl_days * 86_400));
    jar.delete(PENDING_EMAIL_COOKIE);
  } catch (e) {
    return { ...failed(e, fd), values: undefined }; // never echo a code back
  }
  await goToResume();
  return {};
}

export async function resendOtpAction(_: FormState, fd: FormData): Promise<FormState> {
  const email = (await cookies()).get(PENDING_EMAIL_COOKIE)?.value;
  if (!email) redirect("/apply/continue");
  try {
    await resendOtp(portalDeps(), email);
    return { ok: true, message: "If this email has an account, a new code is on its way." };
  } catch (e) {
    return failed(e, fd);
  }
}

// 2.1.3
export async function startAction(): Promise<void> {
  const { deps, c } = await signedInCase();
  markOverviewSeen(deps, c);
  await goToResume();
}

// 2.1.4
export async function identityAction(_: FormState, fd: FormData): Promise<FormState> {
  const { deps, c } = await signedInCase();
  try {
    await saveIdentity(deps, c, textValues(fd), {
      front: await upload(fd, "front"),
      back: await upload(fd, "back"),
      selfie: await upload(fd, "selfie"),
    });
  } catch (e) {
    // Valid files may have been stored before the error (e.g. a selfie retake): refresh "on file".
    revalidatePath("/apply/identity");
    return failed(e, fd);
  }
  redirect(stepPath(nextStep("identity", c)));
}

// 2.1.5
export async function residenceAction(_: FormState, fd: FormData): Promise<FormState> {
  const { deps, c } = await signedInCase();
  try {
    await saveResidence(deps, c, textValues(fd), { por: await upload(fd, "por") });
  } catch (e) {
    return failed(e, fd);
  }
  redirect(stepPath(nextStep("residence", c)));
}

// 2.1.6
export async function questionnaireAction(_: FormState, fd: FormData): Promise<FormState> {
  const { deps, c } = await signedInCase();
  try {
    saveQuestionnaire(deps, c, textValues(fd));
  } catch (e) {
    return failed(e, fd);
  }
  redirect("/apply/status");
}

// 2.1.7
export async function submitAction(_: FormState, fd: FormData): Promise<FormState> {
  const { deps, c } = await signedInCase();
  try {
    await submitCase(deps, c);
  } catch (e) {
    return failed(e, fd);
  }
  // MVP 2 pre-review runs after the response; the applicant never waits for or sees it.
  // MVP 1: Claude is off (spec 01); an analyst can still run it later from the console.
  if (getMode(deps) === "mvp2") after(async () => {
    try {
      await runPreReview(deps, c.id);
    } catch (e) {
      audit(deps.db, deps.now(), "system", "prereview.failed", `case:${c.id}`, { error: e instanceof Error ? e.message : String(e) });
    }
  });
  redirect("/apply/status");
}

export async function signOutAction(): Promise<void> {
  const jar = await cookies();
  endSession(portalDeps(), jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
  redirect("/apply/continue");
}

// EDD (spec 05): proof of source of funds, plus extra KYC when asked.
export async function eddAction(_: FormState, fd: FormData): Promise<FormState> {
  const { deps, c } = await signedInCase();
  try {
    const sof = await Promise.all(
      fd.getAll("sof").filter((f): f is File => f instanceof File && f.size > 0).map(async (f) => ({ name: f.name, type: f.type, size: f.size, bytes: Buffer.from(await f.arrayBuffer()) })),
    );
    await submitEdd(deps, c, { note: textValues(fd).note }, { sof, eddKyc: await upload(fd, "eddKyc") });
  } catch (e) {
    return failed(e, fd);
  }
  redirect("/apply/status");
}

// Company KYB (spec 03)
export async function companyAction(_: FormState, fd: FormData): Promise<FormState> {
  const { deps, c } = await signedInCase();
  try {
    saveCompany(deps, c, textValues(fd));
  } catch (e) {
    return failed(e, fd);
  }
  redirect(stepPath(nextStep("company", c)));
}

export async function personAction(_: FormState, fd: FormData): Promise<FormState> {
  const { deps, c } = await signedInCase();
  try {
    const personId = textValues(fd).personId || undefined;
    await savePerson(
      deps,
      c,
      { ...textValues(fd), roles: fd.getAll("roles").map(String) },
      { poi: await upload(fd, "poi"), por: await upload(fd, "por") },
      { personId, isApplicant: textValues(fd).isApplicant === "true" },
    );
  } catch (e) {
    return failed(e, fd);
  }
  redirect("/apply/persons");
}

export async function removePersonAction(fd: FormData): Promise<void> {
  const { deps, c } = await signedInCase();
  removePerson(deps, c, String(fd.get("personId")));
  revalidatePath("/apply/persons");
}

export async function confirmPersonsAction(_: FormState, fd: FormData): Promise<FormState> {
  const { deps, c } = await signedInCase();
  try {
    confirmPersons(deps, c);
  } catch (e) {
    return failed(e, fd);
  }
  await goToResume();
  return {};
}

export async function companyDocumentsAction(_: FormState, fd: FormData): Promise<FormState> {
  const { deps, c } = await signedInCase();
  const finish = fd.get("intent") === "finish";
  try {
    const files: Record<string, UploadInput[]> = {};
    for (const [key, v] of fd.entries()) {
      if (!key.startsWith("doc_") || !(v instanceof File) || v.size === 0) continue;
      (files[key.slice("doc_".length)] ??= []).push({ name: v.name, type: v.type, size: v.size, bytes: Buffer.from(await v.arrayBuffer()) });
    }
    await saveCompanyDocuments(deps, c, files, { finish });
  } catch (e) {
    return failed(e, fd);
  }
  if (finish) redirect("/apply/status");
  revalidatePath("/apply/documents");
  return { ok: true, message: "Uploaded. Add more, or continue when you're done." };
}
