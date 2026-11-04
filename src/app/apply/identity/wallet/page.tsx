import Link from "next/link";
import { redirect } from "next/navigation";
import { ApplicantShell } from "@/components/applicant-shell";
import { stepCase } from "@/portal/cases";
import { TEST_SCENARIOS } from "@/wallet";
import { TestWalletPanel } from "../../_forms/wallet-forms";
import { requireStep } from "../../session";

// 2.1.4, ID wallet route (docs/spec/09). Individuals only (O-72).
const ASKED: { key: "given_name" | "family_name" | "birth_date" | "nationalities" | "address" | "document_expiry" | "issuing_country"; label: string; why: string; optional?: boolean }[] = [
  { key: "given_name", label: "First name(s)", why: "To confirm who you are" },
  { key: "family_name", label: "Family name", why: "To confirm who you are" },
  { key: "birth_date", label: "Date of birth", why: "To confirm who you are and that you are an adult" },
  { key: "nationalities", label: "Nationality", why: "Financial regulations ask for it" },
  { key: "address", label: "Address", why: "To pre-fill the next step", optional: true },
  { key: "document_expiry", label: "Expiry date of your ID", why: "To check it is still valid", optional: true },
  { key: "issuing_country", label: "Country that issued it", why: "To record where it comes from", optional: true },
];

export default async function WalletPage() {
  const { deps, c } = await requireStep("identity");
  if (c.persona !== "individual") redirect("/apply/identity");
  const request = deps.wallet.verifier.openRequest(c.id);
  if (!request) redirect("/apply/identity");
  const sc = stepCase(c);
  return (
    <ApplicantShell
      panelTitle="Share your ID"
      panelBody="Your ID wallet shares only what we ask for. No photo of a document and no selfie are needed."
      c={sc}
      current="identity"
      title="Share from your ID wallet"
      lede="Approve the request in your wallet. We check the credential is genuine, in date and yours before we use it."
    >
      <div className="stack-lg">
        <section className="stack" aria-labelledby="asked-title">
          <h2 id="asked-title" className="section-title">What we ask for</h2>
          <ul className="bullets">
            {ASKED.map((a) => (
              <li key={a.key}><strong>{a.label}</strong>{a.optional ? " (if your wallet has it)" : ""}: {a.why}</li>
            ))}
          </ul>
        </section>
        <TestWalletPanel scenarios={TEST_SCENARIOS.map((s) => ({ id: s.id, label: s.label, outcome: s.outcome }))} />
        <details>
          <summary>Technical details of this request</summary>
          <pre style={{ overflowX: "auto", fontSize: 12, lineHeight: 1.5 }}>{JSON.stringify({ client_id: request.client_id, response_type: request.response_type, response_mode: request.response_mode, nonce: request.nonce, state: request.state, expires_at: request.expiresAt, dcql_query: request.dcql_query }, null, 2)}</pre>
          <p className="hint">Test mode: the issuer is a built-in demo issuer. Revocation status is not checked in test mode.</p>
        </details>
        <div className="actions">
          <Link href="/apply/identity?method=documents" className="link">Upload a document instead</Link>
          <Link href="/apply/identity" className="link">Back</Link>
        </div>
      </div>
    </ApplicantShell>
  );
}
