"use client";

/**
 * Chaos mode.
 *
 * Every control here forces a *real* code path. `Break SupplierGamma` sends
 * `chaos=fail` to the aggregator, which forwards it to the actual Gamma process,
 * which actually returns a 500, which the actual fan-out actually isolates. None
 * of it is simulated in the UI — a mocked failure would be a screenshot with
 * extra steps, and would prove nothing about the system.
 *
 * The setting travels as a query parameter rather than a header because the
 * search stream is consumed with `EventSource`, which cannot set headers.
 */

export type ChaosMode = "off" | "fail" | "drift";

const OPTIONS: { mode: ChaosMode; label: string; explains: string }[] = [
  {
    mode: "off",
    label: "Normal",
    explains: "Gamma still fails about one request in five on its own.",
  },
  {
    mode: "fail",
    label: "Break SupplierGamma",
    explains:
      "Gamma returns 500 every time. Search still answers 200 with the other two suppliers, and the strip says which one failed.",
  },
  {
    mode: "drift",
    label: "Move the price",
    explains:
      "Gamma quotes a different price than it advertised. Checking the price on a Gamma result is stopped with both amounts shown.",
  },
];

export function ChaosControls({
  mode,
  onChange,
}: {
  mode: ChaosMode;
  onChange: (mode: ChaosMode) => void;
}) {
  const active = OPTIONS.find((option) => option.mode === mode) ?? OPTIONS[0]!;

  return (
    <section aria-label="Chaos mode" className="rounded border border-line bg-card px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] font-semibold tracking-[0.11em] text-muted uppercase">
          Chaos mode
        </span>

        <div className="flex flex-wrap gap-1" role="group" aria-label="Chaos mode">
          {OPTIONS.map((option) => (
            <button
              key={option.mode}
              type="button"
              aria-pressed={mode === option.mode}
              onClick={() => onChange(option.mode)}
              className={`rounded-[3px] border px-2.5 py-1 text-[12px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                mode === option.mode
                  ? "border-ink bg-ink text-white"
                  : "border-line bg-card hover:border-accent"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-2 text-[12px] leading-relaxed text-muted">{active.explains}</p>
    </section>
  );
}
