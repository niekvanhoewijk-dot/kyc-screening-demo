import Link from "next/link";

export default function NotFound() {
  return (
    <div className="card">
      <h1>Page not found</h1>
      <p className="lede">The page you're looking for doesn't exist.</p>
      <Link className="btn" href="/">Go to the start</Link>
    </div>
  );
}
