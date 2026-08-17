import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HomePage from "./page";

describe("HomePage", () => {
  it("lists every supplier the shared model knows about", () => {
    render(<HomePage />);

    expect(screen.getByRole("heading", { level: 1 })).toBeDefined();
    expect(screen.getByText("Supplier alpha")).toBeDefined();
    expect(screen.getByText("Supplier beta")).toBeDefined();
    expect(screen.getByText("Supplier gamma")).toBeDefined();
  });
});
