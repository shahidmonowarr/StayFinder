import { defineConfig } from "prisma/config";

/**
 * Supplied only when the variable exists, so `prisma generate` works on a fresh
 * clone with no `.env` — code generation needs the schema, not a live database.
 * Migration commands still fail loudly, with Prisma's own message about a missing
 * datasource, which is clearer than a config-load error about an env var.
 */
const url = process.env.DATABASE_URL;

/**
 * Prisma 7 moved the connection URL out of `schema.prisma`: the schema now
 * describes shape only, and *how to connect* is configured here for the CLI and
 * via a driver adapter for the client at runtime.
 *
 * The practical consequence is that there is one place a URL comes from for
 * migrations (this file) and one for queries (`db/client.ts`), and both read the
 * same environment variable.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  ...(url === undefined || url === "" ? {} : { datasource: { url } }),
});
