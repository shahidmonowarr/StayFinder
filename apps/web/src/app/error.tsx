"use client";

/**
 * The last line of defence. Most failures in this app are handled where they
 * happen — a supplier failing is a status chip, not an error page — so anything
 * reaching here is genuinely unexpected and says so rather than pretending.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="max-w-lg py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Something broke</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        This one is not a simulated failure. The most likely cause is that the API on port 4000 is
        not running — the page needs it for everything.
      </p>
      <p className="mt-3 font-mono text-xs text-muted">{error.message}</p>
      <div className="mt-6 flex gap-4 text-sm">
        <button type="button" onClick={reset} className="text-accent underline underline-offset-2">
          Try again
        </button>
        <a href="/" className="text-accent underline underline-offset-2">
          Back to search
        </a>
      </div>
    </div>
  );
}
