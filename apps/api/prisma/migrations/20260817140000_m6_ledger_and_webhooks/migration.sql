-- CreateEnum
CREATE TYPE "TransactionKind" AS ENUM ('CHARGE', 'REFUND');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "paymentIntentId" TEXT;

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "kind" "TransactionKind" NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "providerRef" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transactions_bookingId_createdAt_idx" ON "transactions"("bookingId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_paymentIntentId_key" ON "Booking"("paymentIntentId");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The ledger is append-only, and this is what enforces it.
--
-- A comment saying "never update this table" is a comment. A trigger that
-- raises is a guarantee: it holds against application bugs, against a future
-- contributor who has not read the docs, and against anyone with a psql prompt.
--
-- TRUNCATE is deliberately not covered. It is not a row-level operation, so this
-- trigger never sees it, and the integration tests rely on truncating between
-- cases. Wiping the whole table is a destructive admin action, not the silent
-- rewriting of one row that this is here to prevent.
CREATE OR REPLACE FUNCTION transactions_are_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'transactions is append-only: % is not permitted. A refund is a new row, not an edit.',
    TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER transactions_no_update_or_delete
  BEFORE UPDATE OR DELETE ON "transactions"
  FOR EACH ROW EXECUTE FUNCTION transactions_are_append_only();
