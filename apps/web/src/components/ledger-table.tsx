import { formatMoney, netAmount, type LedgerEntry } from "@stayfinder/shared";

/**
 * The money ledger, shown as what it is: a list of rows that only ever grows.
 *
 * The balance underneath is computed from those rows, not read from a field —
 * which is the point worth showing. A refund does not edit the charge above it;
 * it is a second entry that happens to bring the total to zero.
 */
export function LedgerTable({ entries, currency }: { entries: LedgerEntry[]; currency: string }) {
  return (
    <div>
      <h2 className="text-xs font-semibold tracking-wide text-muted uppercase">Ledger</h2>

      {entries.length === 0 ? (
        <p className="mt-3 text-sm text-muted">
          No money has moved yet. A charge appears here when the payment webhook confirms it.
        </p>
      ) : (
        <>
          {/* Its own scroll container: provider references are long opaque ids
              and there is no sensible place to break one, so on a narrow screen
              the table scrolls rather than pushing the whole page sideways. */}
          <div className="mt-3 -mx-1 overflow-x-auto px-1">
            <table className="w-full min-w-[22rem] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="pb-1 font-medium">Entry</th>
                  <th className="pb-1 font-medium">Reference</th>
                  <th className="pb-1 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="border-b border-line/60">
                    <td className="py-2">
                      <span className={entry.kind === "CHARGE" ? "text-ink" : "text-accent"}>
                        {entry.kind}
                      </span>
                      <span className="ml-2 text-xs text-muted">
                        {new Date(entry.createdAt).toLocaleTimeString()}
                      </span>
                    </td>
                    <td className="py-2 font-mono text-xs text-muted">{entry.providerRef}</td>
                    <td className="py-2 text-right tabular-nums">
                      {entry.kind === "REFUND" && "−"}
                      {formatMoney(entry.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="pt-2 text-xs text-muted" colSpan={2}>
                    Balance, summed from the rows above
                  </td>
                  <td className="pt-2 text-right font-medium tabular-nums">
                    {formatMoney(netAmount(entries, currency))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="mt-3 text-xs text-muted">
            Append-only, enforced by a Postgres trigger — <code>UPDATE</code> and{" "}
            <code>DELETE</code> on this table raise an exception. A refund is a new row, never an
            edit to the charge it reverses.
          </p>
        </>
      )}
    </div>
  );
}
