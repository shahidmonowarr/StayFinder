import { SUPPLIER_IDS } from "@stayfinder/shared";

/**
 * Placeholder landing page. The real search experience — progressive results
 * and the supplier-status strip — replaces this in M3/M4.
 */
export default function HomePage() {
  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-semibold tracking-tight text-balance">
        Hotel search across three suppliers that agree on nothing.
      </h1>
      <p className="mt-5 leading-relaxed text-muted">
        StayFinder fans out every search to multiple hotel suppliers in parallel, normalizes three
        incompatible response formats into one model, and streams results back as each supplier
        answers — without letting a slow or failing supplier break the page.
      </p>

      <section className="mt-12">
        <h2 className="text-xs font-semibold tracking-wide text-muted uppercase">Suppliers</h2>
        <ul className="mt-3 divide-y divide-line border-y border-line">
          {SUPPLIER_IDS.map((supplier) => (
            <li key={supplier} className="flex items-center justify-between py-3 text-sm">
              <span className="font-medium capitalize">Supplier {supplier}</span>
              <span className="text-xs text-muted">not wired up yet</span>
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-12 text-sm text-muted">
        Milestone 1 of 7 — scaffold and CI. Search lands in M3.
      </p>
    </div>
  );
}
