"use client";

import Link from "next/link";

// Unexpected failures. Applicant progress is saved after every step, so retrying is safe.
export default function ApplyError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="card">
      <h1>Something went wrong</h1>
      <p className="lede">Your progress up to the last completed step is saved. Please try again.</p>
      <div className="actions">
        <button className="btn" onClick={reset}>Try again</button>
        <Link className="btn secondary" href="/apply/continue">Continue later</Link>
      </div>
    </div>
  );
}
