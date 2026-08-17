import { createApp } from "./app";
import { createSearchCache } from "./cache";
import { env } from "./env";

// Cache construction is async because the Redis client is imported on demand,
// so boot is where the await happens rather than inside `createApp`.
const cache = await createSearchCache(env.redisUrl);

const app = createApp({ cache });

const server = app.listen(env.port, () => {
  console.info(`[api] listening on http://localhost:${env.port} (cache: ${cache.kind})`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      void cache.close().then(() => process.exit(0));
    });
  });
}
