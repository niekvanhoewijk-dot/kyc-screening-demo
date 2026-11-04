import Link from "next/link";
import { ApplicantShell, backPath } from "@/components/applicant-shell";
import { ArrowIcon, Ticked } from "@/components/icons";
import { COUNTRIES, countryName } from "@/lib/countries";
import { stepCase, type IdentityData } from "@/portal/cases";
import { walletEvidenceOf } from "@/portal/evidence";
import { nextStep, stepPath } from "@/portal/steps";
import { startWalletAction } from "../actions";
import { onFileNames } from "../on-file";
import { IdentityForm } from "../_forms/step-forms";
import { requireStep } from "../session";

// 2.1.4 Proof of identity: ID wallet (docs/spec/09) or document + selfie (docs/design/A04-Proof-Of-Identity.dc.html, D5)
export default async function IdentityPage({ searchParams }: { searchParams: Promise<{ method?: string }> }) {
  const { method } = await searchParams;
  const { deps, c } = await requireStep("identity");
  const saved = c.identity as IdentityData | null;
  const wallet = walletEvidenceOf(saved);
  const walletOffered = c.persona === "individual"; // O-72
  const files = onFileNames(deps, c.id);
  const sc = stepCase(c);
  const wantsDocuments = !walletOffered || method === "documents" || (saved !== null && !wallet);

  if (!wantsDocuments) {
    return (
      <ApplicantShell
        panelTitle="Prove who you are"
        panelBody="Share your ID from an ID wallet, or upload a photo of your ID and take a selfie. Either takes about a minute."
        c={sc}
        current="identity"
        title="Proof of identity"
      >
        {wallet ? (
          <div className="stack-lg">
            <div className="panel-soft">
              <Ticked>Verified with your ID wallet</Ticked>
              <p style={{ fontSize: 14, lineHeight: 1.65 }}>
                {wallet.attributes.givenName} {wallet.attributes.familyName}, born {wallet.attributes.birthDate}, {wallet.attributes.nationalities.map(countryName).join(" and ")}.
              </p>
            </div>
            <div className="actions">
              <Link href={stepPath(nextStep("identity", sc))} className="btn">Continue <ArrowIcon /></Link>
              <Link href="/apply/identity?method=documents" className="link">Upload a document instead</Link>
            </div>
          </div>
        ) : (
          <div className="stack-lg">
            <section className="panel-soft" aria-labelledby="wallet-choice">
              <h2 id="wallet-choice" className="section-title">Use your ID wallet</h2>
              <p style={{ fontSize: 14, lineHeight: 1.65, color: "#262626" }}>
                Share your name, date of birth and nationality from your ID wallet. You approve what is shared. No photo of a document and no selfie.
              </p>
              <p className="hint">Test mode: no real wallet is connected. A built-in test wallet stands in, with made-up data.</p>
              <form action={startWalletAction} className="actions">
                <button className="btn" type="submit">Use my ID wallet <ArrowIcon /></button>
              </form>
            </section>
            <section className="panel-soft" aria-labelledby="doc-choice">
              <h2 id="doc-choice" className="section-title">Upload a document instead</h2>
              <p style={{ fontSize: 14, lineHeight: 1.65, color: "#262626" }}>A photo of your passport, ID card or driving licence, and a selfie.</p>
              <div className="actions">
                <Link href="/apply/identity?method=documents" className="btn outline">Upload a document</Link>
                {backPath("identity", sc) && <Link href={backPath("identity", sc)!} className="link">Back</Link>}
              </div>
            </section>
          </div>
        )}
      </ApplicantShell>
    );
  }

  return (
    <ApplicantShell
      panelTitle="Prove who you are"
      panelBody="Upload a photo of your ID, then take a selfie. Both take under two minutes."
      c={sc}
      current="identity"
      title={c.persona === "company" ? "Your proof of identity" : "Proof of identity"}
    >
      <IdentityForm
        docTypes={deps.portal.poi.document_types}
        countries={[...COUNTRIES]}
        saved={wallet ? null : saved}
        onFile={{ front: files.poi_front, back: files.poi_back, selfie: files.selfie }}
        documentAccept={deps.portal.uploads.document_mime.join(",")}
        selfieAccept={deps.portal.uploads.selfie_mime.join(",")}
        selfieRetry={saved?.selfie === "retry"}
        back={backPath("identity", sc)}
      />
      {walletOffered && (
        <form action={startWalletAction} className="actions">
          <button className="link-btn" type="submit">Use my ID wallet instead</button>
        </form>
      )}
    </ApplicantShell>
  );
}
