import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="page max-w-md space-y-4 py-28 text-center">
      <p className="font-display text-7xl font-extrabold text-line-strong">404</p>
      <h1 className="font-display text-2xl font-semibold">That page doesn’t exist</h1>
      <p className="text-sm text-ink-2">The link may be old, or the page may have moved.</p>
      <Link href="/" className="btn btn-primary btn-sm">
        Back to events
      </Link>
    </main>
  );
}
