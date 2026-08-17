import { createApp } from "./app";
import { createSearchCache } from "./cache";
import { createPrismaClient } from "./db/client";
import { env } from "./env";

// Cache construction is async because the Redis client is imported on demand,
// so boot is where the await happens rather than inside `createApp`.
const cache = await createSearchCache(env.redisUrl);

const prisma = env.databaseUrl === undefined ? undefined : createPrismaClient(env.databaseUrl);
if (prisma === undefined) {
  console.warn("[api] DATABASE_URL is unset — /api/quote and /api/bookings will return 503");
}

const app = createApp({ cache, ...(prisma === undefined ? {} : { prisma }) });

const server = app.listen(env.port, () => {
  console.info(`[api] listening on http://localhost:${env.port} (cache: ${cache.kind})`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      void Promise.all([cache.close(), prisma?.$disconnect()]).then(() => process.exit(0));
    });
  });
}
