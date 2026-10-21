import Link from "next/link";

export default function NotFound() {
  return (
    <main className="plain">
      <span className="eyebrow">Demo Digital Assets Platform</span>
      <h1 className="title">Page not found</h1>
      <p className="lede">The page you're looking for doesn't exist.</p>
      <div><Link className="btn" href="/">Go to the start</Link></div>
      <p className="muted">Illustrative demo. Not a regulated compliance system.</p>
    </main>
  );
}
