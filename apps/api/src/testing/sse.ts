import type { Express } from "express";
import { createServer, type Server } from "node:http";

/**
 * Test-only helpers for driving Server-Sent Events.
 *
 * Supertest buffers the whole response, which is exactly the property under test
 * here — whether events arrive progressively — so these tests need a real
 * listening socket and a real `fetch` reading the body as it streams.
 */

export interface ListeningApp {
  url: string;
  close(): Promise<void>;
}

export async function listenOnEphemeralPort(app: Express): Promise<ListeningApp> {
  const server: Server = createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("App did not bind to a TCP port");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

export interface CapturedEvent {
  event: string;
  data: unknown;
  /** Milliseconds from the start of the request, for ordering assertions. */
  atMs: number;
}

/** Parse one SSE block into an event, or undefined for comments/keepalives. */
function parseBlock(block: string, atMs: number): CapturedEvent | undefined {
  let event: string | undefined;
  const dataLines: string[] = [];

  for (const line of block.split("\n")) {
    // Comment lines (": keepalive") carry no event.
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice("event:".length).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).trim());
  }

  if (event === undefined) return undefined;
  return { event, data: JSON.parse(dataLines.join("\n")), atMs };
}

/**
 * Consume an SSE stream to completion, timestamping each event on arrival.
 *
 * `onEvent` fires as events land, which is what lets a test assert that Alpha's
 * leg arrived before Beta's rather than merely that both are present at the end.
 */
export async function collectSse(
  url: string,
  options: { signal?: AbortSignal; onEvent?: (event: CapturedEvent) => void } = {},
): Promise<CapturedEvent[]> {
  const startedAt = performance.now();
  const response = await fetch(url, {
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    headers: { accept: "text/event-stream" },
  });

  if (response.body === null) throw new Error("Response carried no body");

  const events: CapturedEvent[] = [];
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Events are separated by a blank line; anything after the last separator is
    // a partial event and stays in the buffer.
    let separator = buffer.indexOf("\n\n");
    while (separator !== -1) {
      const parsed = parseBlock(buffer.slice(0, separator), performance.now() - startedAt);
      if (parsed !== undefined) {
        events.push(parsed);
        options.onEvent?.(parsed);
      }
      buffer = buffer.slice(separator + 2);
      separator = buffer.indexOf("\n\n");
    }
  }

  return events;
}

export function contentTypeOf(events: CapturedEvent[], event: string): CapturedEvent[] {
  return events.filter((candidate) => candidate.event === event);
}
