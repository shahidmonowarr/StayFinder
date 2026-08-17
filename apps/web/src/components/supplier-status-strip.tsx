import type { SupplierProgress, SupplierUiState } from "@/lib/search-stream";

/**
 * The architecture, made visible.
 *
 * This strip is the reason a visitor can *see* that the search is a fan-out
 * rather than one request: three suppliers, answering at different speeds, one
 * of them regularly failing, and the page carrying on regardless.
 */

const LABEL: Record<SupplierUiState, string> = {
  pending: "waiting",
  slow: "still waiting",
  ok: "responded",
  timeout: "timed out",
  error: "failed",
};

const DOT: Record<SupplierUiState, string> = {
  pending: "bg-muted/40",
  slow: "bg-warn",
  ok: "bg-ok",
  timeout: "bg-warn",
  error: "bg-bad",
};

function detail(progress: SupplierProgress): string {
  const { meta, state } = progress;
  if (meta === undefined) return LABEL[state];

  if (meta.status === "ok") {
    const dropped = meta.droppedCount > 0 ? `, ${meta.droppedCount} dropped` : "";
    return `${meta.latencyMs}ms · ${meta.resultCount} rate${meta.resultCount === 1 ? "" : "s"}${dropped}`;
  }
  return `${LABEL[state]} after ${meta.latencyMs}ms`;
}

export function SupplierStatusStrip({
  suppliers,
  cached,
  elapsedMs,
}: {
  suppliers: SupplierProgress[];
  cached: boolean;
  elapsedMs: number | null;
}) {
  if (suppliers.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-y border-line py-3">
      {suppliers.map((progress) => (
        <div key={progress.supplier} className="flex items-center gap-2 text-xs">
          <span
            aria-hidden="true"
            className={`size-2 rounded-full ${DOT[progress.state]} ${
              progress.state === "pending" || progress.state === "slow" ? "animate-pulse" : ""
            }`}
          />
          <span className="font-medium capitalize">{progress.supplier}</span>
          <span className="text-muted" data-testid={`supplier-${progress.supplier}-detail`}>
            {detail(progress)}
          </span>
        </div>
      ))}

      <div className="ml-auto text-xs text-muted">
        {cached ? "served from cache" : elapsedMs === null ? "searching…" : `${elapsedMs}ms`}
      </div>
    </div>
  );
}
