import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app";

describe("core API", () => {
  const app = createApp();

  it("reports health and the suppliers it knows about", async () => {
    const res = await request(app).get("/health").expect(200);

    expect(res.body.service).toBe("api");
    expect(res.body.status).toBe("ok");
    expect(res.body.suppliers).toEqual(["alpha", "beta", "gamma"]);
  });

  it("answers unknown routes with a structured 404", async () => {
    const res = await request(app).get("/nope").expect(404);

    expect(res.body).toEqual({ error: "NOT_FOUND" });
  });
});
