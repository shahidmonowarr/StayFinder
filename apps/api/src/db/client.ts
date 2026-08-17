import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

/**
 * The database client.
 *
 * Prisma 7 requires a driver adapter rather than reading a URL from the schema,
 * so the connection string is supplied here and nowhere else in the runtime.
 * `prisma.config.ts` supplies the same variable to the CLI for migrations.
 */
export function createPrismaClient(connectionString: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

export type { PrismaClient };
