import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

/**
 * Test-only. A throwaway HTTP server on an ephemeral port.
 *
 * The adapter tests exercise normalization on captured payloads directly, but
 * that leaves the parts that actually break in production untested: URL and
 * parameter construction, status handling, and whether the abort signal really
 * cancels an in-flight request. Those need a socket.
 *
 * A real server rather than a `fetch` mock, and `node:http` rather than
 * importing the supplier packages — the API workspace must not depend on
 * supplier source, or the dependency arrow points the wrong way.
 */

export interface FixtureServer {
  url: string;
  /** Paths and query strings this server was asked for, in order. */
  requests: string[];
  close(): Promise<void>;
}

export type FixtureHandler = (req: IncomingMessage, res: ServerResponse) => void;

/** Respond with JSON, the ordinary case. */
export function jsonHandler(payload: unknown, status = 200): FixtureHandler {
  return (_req, res) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
  };
}

/** Respond the way a failing gateway does: a status and an unparseable body. */
export function plainTextHandler(status: number, body = "Internal Server Error"): FixtureHandler {
  return (_req, res) => {
    res.writeHead(status, { "content-type": "text/plain" });
    res.end(body);
  };
}

/** Accept the request and never answer, so only the deadline can end it. */
export function silentHandler(): FixtureHandler {
  return () => {
    // Intentionally empty: no write, no end.
  };
}

export async function startFixtureServer(handler: FixtureHandler): Promise<FixtureServer> {
  const requests: string[] = [];

  const server: Server = createServer((req, res) => {
    requests.push(req.url ?? "");
    handler(req, res);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Fixture server did not bind to a TCP port");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        // closeAllConnections, or a request parked by silentHandler keeps the
        // server open and the test suite hangs on teardown.
        server.closeAllConnections();
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}
