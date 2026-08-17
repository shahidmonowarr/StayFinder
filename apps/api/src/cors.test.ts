import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app";

/**
 * These exist because unit tests could not have caught the bug they cover: the
 * whole API and UI passed 240 tests while the page showed "Lost connection",
 * because nothing in the suite ever made a *cross-origin* request. Only opening
 * a browser did.
 */
describe("CORS", () => {
  const app = createApp({ adapters: [], webOrigin: "http://localhost:3000" });

  it("allows the configured browser origin", async () => {
    const res = await request(app)
      .get("/health")
      .set("Origin", "http://localhost:3000")
      .expect(200);

    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
  });

  it("allows the streaming endpoint too, which is what the page actually opens", async () => {
    const res = await request(app)
      .get("/api/search/stream?destination=Lisbon&checkIn=2026-09-01&checkOut=2026-09-04")
      .set("Origin", "http://localhost:3000")
      .expect(200);

    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
  });

  it("varies on Origin so a shared cache cannot leak one origin's grant to another", async () => {
    const res = await request(app).get("/health").set("Origin", "http://localhost:3000");

    expect(res.headers["vary"]).toContain("Origin");
  });

  it("refuses an origin that was not configured", async () => {
    const res = await request(app).get("/health").set("Origin", "http://evil.example").expect(200);

    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("answers a preflight without falling through to the 404 handler", async () => {
    await request(app).options("/api/search").set("Origin", "http://localhost:3000").expect(204);
  });

  it("adds no headers to a same-origin request", async () => {
    const res = await request(app).get("/health").expect(200);

    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("allows any origin when configured with a wildcard", async () => {
    const open = createApp({ adapters: [], webOrigin: "*" });

    const res = await request(open)
      .get("/health")
      .set("Origin", "http://anywhere.test")
      .expect(200);

    expect(res.headers["access-control-allow-origin"]).toBe("http://anywhere.test");
  });
});
