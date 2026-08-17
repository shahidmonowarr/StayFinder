import { createPrismaClient, type PrismaClient } from "../db/client";

/**
 * Test-only database wiring.
 *
 * Integration tests run against a real Postgres — mocking Prisma would test the
 * mock, and the rules being verified here (unique constraints, transactional
 * writes) are enforced *by the database*, so a fake would prove nothing.
 *
 * Skipped when `TEST_DATABASE_URL` is unset, in the same way as the Redis suite.
 * CI supplies one, so the coverage is real; locally it needs
 * `docker compose up -d`.
 */

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

export const hasTestDatabase = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== "";

let client: PrismaClient | undefined;

export function testPrisma(): PrismaClient {
  if (!hasTestDatabase) {
    throw new Error("TEST_DATABASE_URL is not set; this suite should have been skipped");
  }
  client ??= createPrismaClient(TEST_DATABASE_URL!);
  return client;
}

/**
 * Empty the tables between cases.
 *
 * `TRUNCATE ... CASCADE` rather than deleting rows: it is faster, it resets
 * nothing we depend on, and it makes the cascade from bookings to their events
 * explicit rather than relying on delete order.
 */
export async function resetDatabase(): Promise<void> {
  const prisma = testPrisma();
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "BookingEvent", "Booking", "Quote" RESTART IDENTITY CASCADE',
  );
}

export async function closeTestDatabase(): Promise<void> {
  await client?.$disconnect();
  client = undefined;
}
