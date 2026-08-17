import {
  compareByPrice,
  STREAM_EVENT,
  type HotelOption,
  type StreamDoneEvent,
  type StreamLegEvent,
  type StreamMetaEvent,
  type SupplierId,
  type SupplierMeta,
} from "@stayfinder/shared";

/**
 * Client-side state for a streaming search, as a pure reducer.
 *
 * The reducer is separated from the hook so the interesting behaviour — legs
 * accumulating, the list re-sorting when a cheap late supplier lands, pending
 * suppliers ageing into "slow" — is testable without an EventSource, a DOM, or
 * a timer.
 */

/**
 * `pending` and `slow` are inventions of this layer. The API reports only
 * `ok` / `timeout` / `error`, which are facts; whether 800ms counts as slow is a
 * judgement about humans, and it does not belong in a response contract.
 */
export type SupplierUiState = "pending" | "slow" | "ok" | "timeout" | "error";

export interface SupplierProgress {
  supplier: SupplierId;
  state: SupplierUiState;
  /** Present once the supplier has actually answered. */
  meta?: SupplierMeta;
}

export interface SearchStreamState {
  phase: "idle" | "streaming" | "done";
  cached: boolean;
  options: HotelOption[];
  suppliers: SupplierProgress[];
  elapsedMs: number | null;
  /**
   * When this search began, on the client's clock. Carried in the action
   * rather than read here, so the reducer stays pure — and it is what lets the
   * trace draw a *growing* bar for a supplier that has not answered yet.
   */
  startedAt: number | null;
  /** Set when the stream itself broke, as opposed to a supplier failing. */
  error: string | null;
}

export const initialSearchStreamState: SearchStreamState = {
  phase: "idle",
  cached: false,
  options: [],
  suppliers: [],
  elapsedMs: null,
  startedAt: null,
  error: null,
};

export type SearchStreamAction =
  | { type: "start"; at: number }
  | { type: typeof STREAM_EVENT.meta; event: StreamMetaEvent }
  | { type: typeof STREAM_EVENT.leg; event: StreamLegEvent }
  | { type: typeof STREAM_EVENT.done; event: StreamDoneEvent }
  | { type: "slow" }
  | { type: "failed"; message: string };

export function searchStreamReducer(
  state: SearchStreamState,
  action: SearchStreamAction,
): SearchStreamState {
  switch (action.type) {
    case "start":
      // A new search discards the old results outright. Keeping them while the
      // next set streams in would show prices for a stay nobody asked about.
      return { ...initialSearchStreamState, phase: "streaming", startedAt: action.at };

    case STREAM_EVENT.meta:
      return {
        ...state,
        cached: action.event.cached,
        // Every supplier appears immediately as pending, so the strip is
        // complete from the first frame instead of growing chip by chip.
        suppliers: action.event.suppliers.map((supplier) => ({ supplier, state: "pending" })),
      };

    case STREAM_EVENT.leg: {
      const { meta, options } = action.event;
      return {
        ...state,
        suppliers: state.suppliers.map((progress) =>
          progress.supplier === meta.supplier
            ? { supplier: meta.supplier, state: meta.status, meta }
            : progress,
        ),
        // Re-sorted on every arrival, which is what makes a cheap late supplier
        // visibly jump to the top of the list.
        options: [...state.options, ...options].sort(compareByPrice),
      };
    }

    case "slow":
      return {
        ...state,
        // Only still-waiting suppliers age into "slow" — a supplier that has
        // already answered is not slow, whatever the clock says.
        suppliers: state.suppliers.map((progress) =>
          progress.state === "pending" ? { ...progress, state: "slow" } : progress,
        ),
      };

    case STREAM_EVENT.done:
      return { ...state, phase: "done", elapsedMs: action.event.elapsedMs };

    case "failed":
      return {
        ...state,
        phase: "done",
        error: action.message,
        // Suppliers still outstanding when the stream broke never answered, and
        // saying so is more honest than leaving them spinning forever.
        suppliers: state.suppliers.map((progress) =>
          progress.state === "pending" || progress.state === "slow"
            ? { ...progress, state: "error" }
            : progress,
        ),
      };

    default:
      return state;
  }
}

/** True while at least one supplier is still outstanding. */
export function isWaitingForAnySupplier(state: SearchStreamState): boolean {
  return state.suppliers.some(
    (progress) => progress.state === "pending" || progress.state === "slow",
  );
}
