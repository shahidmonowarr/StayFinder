# Architecture

This document is written as the system is built. Sections marked _(planned)_
describe a milestone that has not landed yet; everything else describes code
that exists in the repo today.

---

## The problem

An OTA does not own inventory. It asks suppliers, and suppliers are
heterogeneous, slow, and unreliable in ways the user must never see. Three
concrete problems follow from that:

1. **Shape mismatch.** Every supplier returns a different JSON structure, a
   different casing convention, and a different idea of what "price" means.
2. **Latency and failure spread.** The slowest supplier decides how slow the
   page is, unless the design refuses to let it.
3. **Price drift.** The price a supplier advertises in search is not
   necessarily the price it will honour at booking time.

StayFinder is a miniature, fully local system that solves those three problems
and nothing else.

---

## Service topology

```mermaid
flowchart LR
    subgraph browser [Browser]
        WEB["Next.js app<br/>:3000"]
    end

    subgraph core [Core]
        API["Aggregation API<br/>:4000"]
        CACHE[("Redis<br/>60s search TTL")]
        DB[("Postgres<br/>bookings + ledger")]
    end

    subgraph suppliers [Mock suppliers]
        A["Alpha :4001<br/>REST · cents · fast"]
        B["Beta :4002<br/>REST · strings · slow"]
        G["Gamma :4003<br/>GraphQL · flaky"]
    end

    WEB -->|"search, stream of results"| API
    API --> CACHE
    API --> DB
    API -->|"parallel fan-out<br/>1500ms deadline each"| A
    API --> B
    API --> G
```

The three suppliers are separate processes on separate ports, not in-process
fakes. That distinction matters: a real network hop is what makes timeouts,
partial failure, and streaming behave like the production problem instead of a
simulation of it.

---

## The unified model

Every supplier response is normalized into `HotelOption` inside its supplier
adapter, and nothing downstream of the adapters may branch on `supplier` to
interpret a price. The type lives in
[`packages/shared/src/hotel-option.ts`](../packages/shared/src/hotel-option.ts).

| Field                           | Notes                                                                 |
| ------------------------------- | --------------------------------------------------------------------- |
| `id`                            | `${supplier}:${supplierHotelId}`, unique across the merged result set |
| `supplier`, `supplierHotelId`   | Who sold it and their own key — required to re-quote later            |
| `name`, `city`, `starRating`    | Display fields; `starRating` is `0` when the supplier does not rate   |
| `nightlyRate`, `totalPrice`     | **Both always populated**, whichever basis the supplier quoted in     |
| `checkIn`, `checkOut`, `nights` | `checkOut` is exclusive — the checkout day is not a night             |
| `guests`, `refundable`          | Echoed from the query / supplier                                      |
| `dedupeKey`                     | Identity of the physical hotel, independent of who is selling it      |

### Why both price bases are always present

Alpha quotes per night. Beta quotes stay totals. Gamma quotes per night inside
a nested object. If the model stored "the price the supplier gave us" plus a
basis flag, every consumer — sorting, dedup, the price-change check, the
checkout summary — would have to re-derive the other basis, and each of them
would round slightly differently. Normalizing both directions once, in
[`money.ts`](../packages/shared/src/money.ts), makes a rounding bug a single-file
problem.

### Why money is an integer

Prices are integer minor units (`12990` is €129.90), never floats. Beta sends
decimal strings, which are parsed by string surgery rather than `parseFloat`,
because `0.29 * 100` is `28.999999999999996` in IEEE-754 and a booking engine
that loses a cent per search loses trust faster than it loses money.

Where a derived value cannot divide evenly — Beta's stay total spread across
three nights — the **nightly rate is display-grade and the stay total stays
authoritative**. The ledger always records the total the supplier actually
quoted, never a re-multiplied nightly rate.

Multi-currency is out of scope, so a fixed minor-unit exponent of 2 is assumed.
The currency code is still carried on every `Money` so that a mismatched merge
throws instead of silently averaging two currencies together.

---

## Supplier contracts

Each mock supplier is deliberately awkward in a different, realistic way.

|              | Alpha         | Beta                            | Gamma              |
| ------------ | ------------- | ------------------------------- | ------------------ |
| Protocol     | REST          | REST                            | GraphQL            |
| Casing       | `camelCase`   | `snake_case`                    | nested `camelCase` |
| Price format | integer cents | decimal string + currency field | nested object      |
| Price basis  | per night     | stay total                      | per night          |
| Latency      | ~100ms        | 800–2000ms                      | ~300ms             |
| Failure rate | 0%            | 0%                              | 20% → HTTP 500     |
| Price drift  | none          | none                            | 10% of quotes      |

Beta's latency ceiling sits **above** the aggregator's 1500ms deadline on
purpose, so timeouts occur naturally during a demo rather than needing to be
staged. Gamma's price drift is what forces quote revalidation to exist.

### Endpoints

|                | Alpha                            | Beta                                   | Gamma                          |
| -------------- | -------------------------------- | -------------------------------------- | ------------------------------ |
| Search         | `GET /hotels`                    | `GET /v1/availability`                 | `POST /graphql` `searchHotels` |
| Quote          | `GET /hotels/:id/quote`          | `GET /v1/availability/:id/price`       | `POST /graphql` `hotelQuote`   |
| Destination by | city name (`destination=Lisbon`) | **city code** (`destination_code=LIS`) | city name                      |
| Guests param   | `guests`                         | `occupancy`                            | `guests`                       |
| Error shape    | `{ error, message }`             | `{ error_code, error_message }`        | GraphQL `errors[]`             |

Beta indexing on city code rather than name is not decoration: the M3 adapter
has to hold a destination→code mapping that the other two adapters do not need,
which is the ordinary shape of supplier onboarding work.

### The same hotel, three ways

All three sell the property below for the same three-night stay. This is the
entire normalization problem in one screen.

```jsonc
// Alpha — GET /hotels?destination=Lisbon&checkIn=2026-09-01&checkOut=2026-09-04&guests=2
{
  "hotelId": "ALPHA-1042",
  "name": "Grand Meridian Lisbon",
  "starRating": 5,
  "nightlyRateCents": 12990, // integer minor units, per night
  "currency": "EUR",
  "refundable": true,
}
```

```jsonc
// Beta — GET /v1/availability?destination_code=LIS&check_in_date=2026-09-01&…
{
  "hotel_id": "bt_88",
  "hotel_name": "Grand Meridian, Lisbon", // note the comma
  "category": "4_STAR", // and a different star rating
  "total_price": "375.00", // decimal STRING, whole stay
  "currency": "EUR",
  "cancellation_policy": "FREE_CANCELLATION",
  "nights": 3,
}
```

```jsonc
// Gamma — POST /graphql { searchHotels(input: …) }
{
  "node": {
    "id": "gamma:hotel:7",
    "property": {
      "name": "GRAND MERIDIAN LISBON",
      "rating": { "stars": 5 },
    },
    "pricing": {
      "perNight": { "amount": 13500, "currency": { "code": "EUR" } },
      "refundable": false, // and it disagrees with Alpha about cancellation
    },
  },
}
```

Three names, three ID schemes, three price encodings, two price bases, and a
disagreement about whether the booking is refundable — for one building. The
aggregator has no shared key to join on, so identity is inferred by normalizing
the name (case, punctuation, diacritics, whitespace) together with the city.

### Chaos, made reproducible

Gamma's misbehaviour is driven by a seeded PRNG rather than `Math.random()`, and
can be overridden per request with an `x-chaos` header:

| Header           | Effect                                         |
| ---------------- | ---------------------------------------------- |
| `x-chaos: fail`  | this request returns HTTP 500                  |
| `x-chaos: drift` | this quote returns a price search never showed |
| `x-chaos: none`  | behave, whatever the roll says                 |
| _(absent)_       | seeded roll: 20% fail, 10% drift               |

Two requirements pull against each other here. A demo wants genuine surprise;
a test suite and the M7 chaos button need failure on command. A seeded
generator plus an explicit override satisfies both without a branch on
`NODE_ENV`.

The failure is injected at the transport layer, ahead of GraphQL, so it arrives
as an opaque `500` with a plain-text body rather than a well-formed `errors`
array. That is what a failing gateway in front of a supplier actually looks
like, and it is harsher on the consumer — the aggregator has to survive a
response it cannot parse at all.

---

## Fan-out and isolation

`/api/search` dispatches to all three suppliers concurrently with a hard
1500ms per-supplier deadline. A supplier that fails or times out contributes a
`SupplierMeta` with status `error` or `timeout` and zero options; it never
rejects the request. `timeout` and `error` stay distinct because they mean
different things to an operator — a timeout is a supplier that may still be
healthy, an error is one that answered wrongly.

Per-supplier status is part of the response contract, not a debug extra: a
response is still valid when a supplier is missing, and the UI has to be able
to say so honestly rather than implying the results are complete.

### The layering

```
route          validates the query, shapes the response
  └─ fanout    runs N legs concurrently, applies deadlines, classifies outcomes
       └─ adapter × 3   speaks one supplier's protocol, returns HotelOption
```

[`fanout.ts`](../apps/api/src/orchestrator/fanout.ts) knows nothing about HTTP,
hotels, or which suppliers exist — it takes adapters as an argument. That is
what makes deadlines, isolation, and classification testable without a network,
and it means adding a fourth supplier is a new file in
[`adapters/`](../apps/api/src/adapters) plus one line in the registry.

### Deadlines abort; they do not merely stop waiting

The deadline is `AbortSignal.timeout(1500)` passed into `fetch`, not a
`Promise.race` against a timer. Racing a timer _looks_ equivalent and is not:
the losing request stays open, its body keeps streaming into a handler nobody
is listening to, and the socket leaks. Under load that is the difference
between a slow supplier and an exhausted connection pool.

Each leg gets its own signal. A shared one would mean the first supplier to
time out cancels the two that were about to succeed.

All legs are dispatched before any is awaited, so the deadlines run
concurrently: worst-case wall clock is **one** timeout plus normalization, not
three.

### Always HTTP 200

A search where every supplier fell over is still a successful search. Nothing
is wrong on our side, so the response is a 200 with an empty `options` array
and a status block that says exactly what happened. Returning a 5xx would tell
the client to retry a request that will fail identically, and would make
"one supplier is down" indistinguishable from "the aggregator is broken".

### Partial failure inside a healthy supplier

Normalization runs per row. A single unparseable rate — a bad currency code, a
price `Money` refuses — drops that row and increments `droppedCount` on the
supplier's metadata, leaving the rest of its inventory intact and its status
`ok`. Failing the whole leg over one malformed record would throw away good
inventory; hiding the drop would let a supplier silently shed half its stock.
Only when the envelope itself is unreadable does the leg become `error`.

### Observed behaviour

Eight consecutive live searches against the real suppliers, no chaos forcing:

```
7 options  alpha:ok(123ms,3)  beta:ok(935ms,2)      gamma:ok(329ms,2)
5 options  alpha:ok(104ms,3)  beta:ok(1460ms,2)     gamma:error(306ms,0)
7 options  alpha:ok(105ms,3)  beta:ok(1298ms,2)     gamma:ok(308ms,2)
7 options  alpha:ok(103ms,3)  beta:ok(1324ms,2)     gamma:ok(308ms,2)
5 options  alpha:ok(103ms,3)  beta:timeout(1505ms,0) gamma:ok(308ms,2)
7 options  alpha:ok(103ms,3)  beta:ok(1141ms,2)     gamma:ok(309ms,2)
```

All three statuses occur without being staged, and every request returned 200.
Note Beta at 1460ms on the second row and 1505ms on the fifth: the deadline sits
inside its latency distribution on purpose, so the timeout path is ordinary
rather than exotic.

Killing SupplierAlpha's process outright:

```
alpha  error       16ms  fetch failed: connect ECONNREFUSED ::1:4001
beta   ok         961ms
gamma  ok         320ms
-> HTTP 200, 5 options from the survivors
```

That message is unwrapped deliberately. Node reports every transport failure as
`TypeError: fetch failed` and buries the reason in `cause` — and when the host is
`localhost` rather than a literal IP, `cause` is an `AggregateError` whose own
message is the empty string, because the name resolves to both `::1` and
`127.0.0.1` and undici attempts both. Reading `.message` on that yields nothing,
so a dead supplier and a DNS failure look identical in the status strip. Both
shapes are handled in
[`fanout.ts`](../apps/api/src/orchestrator/fanout.ts).

### Merging

Every supplier's offer survives into `options[]` with `dedupeKey` populated;
`groupByProperty` (in `packages/shared`, so the UI can use it too) collapses
them for display. A live Lisbon search returns 7 offers across 4 buildings:

| Property            | Offers                                  | Cheapest  |
| ------------------- | --------------------------------------- | --------- |
| Grand Meridian      | alpha 389.70, beta 375.00, gamma 405.00 | **beta**  |
| Casa do Tejo        | alpha 253.50, gamma 243.00              | **gamma** |
| Alfama Boutique     | alpha 183.00                            | alpha     |
| Hotel Baixa Central | beta 162.00                             | beta      |

Beta — the slowest supplier — holds the best price on the property all three
sell. That is the case that makes progressive streaming interesting rather than
merely faster: the cheapest result is the last to arrive.

## Progressive delivery

`/api/search/stream` pushes each supplier's results the moment they exist.
`fanOut` gained an `onLeg` callback that fires per leg in _completion_ order;
the buffered route omits it, the SSE route turns each call into an event. One
orchestrator, so there is no second copy of the deadline logic to drift.

```
event: meta   {query, suppliers: ["alpha","beta","gamma"], cached}
event: leg    {meta: SupplierMeta, options: HotelOption[]}   × 3
event: done   {elapsedMs}
```

A `leg` carries a supplier's status _and_ its options together. Separate status
and result events would force the client to correlate them for no benefit: a
leg either produced options or it did not, and either way that is one fact
arriving at one moment.

Watched from a terminal — which is the practical reason for SSE over a chunked
JSON stream:

```
[    0ms] meta   cached=False suppliers=['alpha', 'beta', 'gamma']
[   85ms] leg    alpha  ok         122ms  3 options
[  312ms] leg    gamma  ok         336ms  2 options
[ 1478ms] leg    beta   timeout   1503ms  0 options
[ 1478ms] done   elapsed=1517ms
```

The client accumulates and re-sorts with `compareByPrice` from
`packages/shared` on every arrival, which is why a cheap late supplier visibly
jumps to the top rather than appearing at the bottom.

Two details that decide whether this works at all in front of a proxy:
`Cache-Control: no-transform` (a proxy that compresses the body buffers it, and
buffering defeats the entire point) and `X-Accel-Buffering: no`. A client
disconnect aborts the in-flight legs — with nobody to send to, holding supplier
connections open is pure waste.

`EventSource` reconnects automatically, so the client **must** close on `done`.
A stream left open would silently re-run the whole fan-out, forever.

## Caching

Redis with a 60s TTL, keyed `search:v1:{destination}:{checkIn}:{checkOut}:{guests}`,
falling back to an in-memory cache when `REDIS_URL` is unset so the demo runs on
a laptop with nothing installed.

**A cache never breaks a search.** `resilientCache` wraps either backend: a
failed read reads as a miss, a failed write is dropped, both reported through a
logger. That guarantee lives in one place, which is why the two backends
underneath are thin and allowed to throw.

**Only complete result sets are cached.** If Gamma 500s, storing that response
would hand the degraded set to every visitor for the next minute. A re-run costs
one fan-out; sticky partial failure costs sixty seconds of wrong prices. Live,
across three consecutive searches:

```
attempt 1   cached=False   alpha ok · gamma error · beta timeout   → not stored
attempt 2   cached=False   alpha ok · gamma ok    · beta ok        → stored
attempt 3   cached=True    all three legs replayed at 0ms
```

A hit replays the same event protocol rather than short-circuiting it, so the
client keeps one code path and can still show what each supplier contributed —
honestly labelled as cached.

The `v1` in the key is load-bearing: `HotelOption` changes in later milestones,
and a running Redis would otherwise serve entries of the old shape into new code.

## The supplier-status strip

`pending` and `slow` exist only in the UI. The API reports `ok` / `timeout` /
`error` — facts. Whether 800ms counts as "slow" is a judgement about humans and
does not belong in a response contract, so it is a client-side timer instead.

Cross-origin access is a real requirement, not an oversight: the page is served
from `:3000` and calls the API on `:4000` directly, because the aggregator is a
separate service rather than a Next.js route handler. The alternative — proxying
through Next's `rewrites` — would hide that topology in the network tab.

## Quote revalidation _(planned — M5)_

`/api/quote` re-asks the owning supplier for a live price. If it differs from
the searched price, the API returns `PRICE_CHANGED` with both amounts and the
UI must surface it before the user can continue to payment.

## Booking state machine and ledger _(planned — M5/M6)_

`PENDING → CONFIRMED → CANCELLED → REFUNDED`, plus `FAILED`. Illegal
transitions throw. The machine is a pure module with no I/O so it can be
exhaustively unit-tested. Booking creation is idempotent on a client-supplied
key; Stripe confirmation is webhook-driven and duplicate deliveries are
absorbed. The `transactions` table is append-only — refunds are new rows, never
updates — so the financial history of a booking is reconstructible by replay.

---

## Repository layout

```
apps/web         Next.js App Router frontend
apps/api         Core aggregation service (Express) + Prisma schema
suppliers/*      Three standalone mock supplier services
packages/shared  HotelOption, SupplierMeta, Money — the cross-service contract
packages/tsconfig, packages/eslint-config   Shared build/lint presets
```

`packages/shared` exports TypeScript source rather than a build artifact, so no
compile step sits between an edit and the service that consumes it. Turborepo
runs `lint`, `typecheck`, `test`, and `build` across every workspace.
