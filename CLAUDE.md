# Project: StayFinder — Multi-Supplier Hotel Search & Booking Engine

## What this is
A portfolio project demonstrating OTA (online travel agency) supplier-aggregation
engineering: parallel fan-out to multiple heterogeneous suppliers, result
normalization, progressive streaming, caching, quote-time revalidation, and a
payment-safe booking state machine. Built by a mid-level full-stack engineer who
works on a production OTA — this project is the public, miniature proof of that work.

## Non-negotiable goals
1. The architecture must be the star. Code clarity > feature count.
2. Everything must be demoable live with seeded data — no empty states.
3. A recruiter should understand the system from the README in 60 seconds;
   an engineer should find real substance in 10 minutes.

## Stack
- Monorepo (npm workspaces or turborepo)
- Frontend: Next.js (App Router) + TypeScript + Tailwind CSS
- Core API: Node.js + TypeScript (Express or Nest.js)
- Mock suppliers: 3 tiny standalone Node services (same repo, /suppliers folder)
- Database: PostgreSQL + Prisma
- Cache: Redis (with in-memory fallback so the demo runs without Redis)
- Tests: Vitest (unit for the orchestrator + state machine), a few integration tests
- CI: GitHub Actions — lint, typecheck, test on every push

## System design (build exactly this)

### Mock suppliers (the trick that makes this project convincing)
Three fake supplier APIs with deliberately DIFFERENT contracts:
- **SupplierAlpha**: REST, camelCase JSON, prices in cents, fast (~100ms),
  reliable. Nightly rate only.
- **SupplierBeta**: REST, snake_case, prices as decimal strings with separate
  currency field, SLOW (800–2000ms random latency). Returns total-stay price.
- **SupplierGamma**: GraphQL, nested response shape, FLAKY — 20% of requests
  fail with 500, and 10% of quotes return a DIFFERENT price than search
  (simulates real-world price drift between search and quote).
Each supplier has its own seeded hotel inventory (some hotels overlap across
suppliers with different prices — dedup/merge logic must handle this).

### Core aggregation service
- `/api/search`: fans out to all suppliers in PARALLEL with a 1500ms hard
  timeout per supplier. Suppliers that fail or time out are isolated — their
  errors never break the response. Response includes per-supplier status
  metadata (ok / timeout / error) so the UI can show it.
- Normalizes all three response shapes into ONE unified `HotelOption` model
  (documented in /docs/architecture.md).
- Progressive delivery: stream results to the frontend as each supplier
  responds (SSE or streaming response), don't wait for the slowest.
- Redis cache on search results, 60s TTL, keyed by (destination, dates, guests).
- `/api/quote`: re-fetches live price from the owning supplier. If price
  changed since search (SupplierGamma will trigger this), return a
  PRICE_CHANGED response the UI must surface to the user before booking.

### Booking + payment state machine
- Explicit states: PENDING → CONFIRMED → CANCELLED → REFUNDED (+ FAILED).
  Illegal transitions must throw. State machine is a pure, unit-tested module.
- Idempotency: booking creation accepts an idempotency key; replaying the
  same key returns the original booking, never a duplicate.
- Payments: Stripe test mode. Confirmation is webhook-driven, not
  redirect-driven. Duplicate webhook deliveries must be handled idempotently.
- Append-only `transactions` ledger table — no row is ever updated or
  deleted; refunds are new entries.
- "Chaos mode" toggle in the demo UI: simulates duplicate webhooks and a
  supplier price change, so a visitor can WATCH the safeguards hold.

### Frontend
- Search page: destination + dates + guests. Results appear progressively
  with skeleton cards; a small supplier-status strip shows each supplier's
  state (responding / slow / failed) — this visualizes the architecture.
- Hotel detail → quote → checkout (Stripe test card) → booking confirmation
  with state timeline. Cancel flow triggers refund path.
- Clean, professional design. No purple-gradient template look.

## Working agreements (how to build with me)
- ALWAYS present a plan before writing code for a milestone; wait for my OK.
- Build in these milestones, one at a time, git commit after each:
  M1 repo scaffold + CI. M2 mock suppliers + seed data. M3 aggregation
  /search with fan-out, timeouts, normalization. M4 streaming + Redis +
  supplier-status UI. M5 quote revalidation + booking state machine + tests.
  M6 Stripe + webhooks + idempotency + ledger. M7 chaos mode + polish +
  README with architecture diagram (Mermaid).
- Write tests for the orchestrator, state machine, and idempotency BEFORE
  declaring a milestone done. Run lint + typecheck + tests before every commit.
- Conventional commit messages (feat:, fix:, test:, docs:).
- README must include: problem statement (3 sentences), architecture diagram,
  "Design decisions" section (why 1500ms timeouts, why append-only ledger,
  why streaming), local setup in ≤5 commands, and a link placeholder for the
  live demo.
- Keep secrets in .env, provide .env.example, never commit real keys.

## Out of scope (do not build)
Auth beyond a simple session, multi-currency, i18n, admin panel, real
supplier integrations, mobile app. Depth over breadth.
