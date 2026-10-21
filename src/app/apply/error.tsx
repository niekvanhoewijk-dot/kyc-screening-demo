"use client";

import Link from "next/link";
import { LeftPanel } from "@/components/left-panel";

// Unexpected failures. Applicant progress is saved after every step, so retrying is safe.
export default function ApplyError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="frame">
      <LeftPanel title="Something went wrong" body="Nothing is lost: your progress up to the last completed step is saved." />
      <main className="content center">
        <div className="col narrow">
          <div className="head">
            <h1 className="title">Something went wrong</h1>
            <p className="lede">Your progress up to the last completed step is saved. Please try again.</p>
          </div>
          <div className="actions">
            <button className="btn" onClick={reset}>Try again</button>
            <Link className="link" href="/apply/continue">Continue later</Link>
          </div>
        </div>
      </main>
    </div>
  );
}
