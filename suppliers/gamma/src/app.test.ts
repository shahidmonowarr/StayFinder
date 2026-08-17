import request from "supertest";
import { describe, expect, it } from "vitest";
import { CONTRACT, createApp } from "./app";

describe("supplier-gamma", () => {
  const app = createApp();

  it("reports health and advertises its contract", async () => {
    const res = await request(app).get("/health").expect(200);

    expect(res.body.service).toBe("supplier-gamma");
    expect(res.body.status).toBe("ok");
    expect(res.body.contract).toEqual(JSON.parse(JSON.stringify(CONTRACT)));
  });

  it("answers unknown routes with a structured 404", async () => {
    const res = await request(app).get("/nope").expect(404);

    expect(res.body).toEqual({ error: "NOT_FOUND" });
  });
});
