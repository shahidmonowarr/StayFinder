import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { searchStreamUrl } from "@/lib/use-search-stream";
import { ChaosControls } from "./chaos-controls";
import { RecentBookings, type RecentBooking } from "./recent-bookings";
import { fromMinor } from "@stayfinder/shared";

describe("ChaosControls", () => {
  it("offers the three modes", () => {
    render(<ChaosControls mode="off" onChange={() => undefined} />);

    expect(screen.getByRole("button", { name: "Normal" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Break SupplierGamma" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Move the price" })).toBeDefined();
  });

  it("marks the active mode for assistive technology, not just visually", () => {
    render(<ChaosControls mode="fail" onChange={() => undefined} />);

    expect(
      screen.getByRole("button", { name: "Break SupplierGamma" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByRole("button", { name: "Normal" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("reports the selection", () => {
    const onChange = vi.fn();
    render(<ChaosControls mode="off" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Move the price" }));

    expect(onChange).toHaveBeenCalledWith("drift");
  });

  it("explains what each mode does, since a held safeguard looks like nothing happening", () => {
    const { rerender } = render(<ChaosControls mode="off" onChange={() => undefined} />);
    expect(screen.getByText(/one request in five/)).toBeDefined();

    rerender(<ChaosControls mode="fail" onChange={() => undefined} />);
    expect(screen.getByText(/Search still answers 200/)).toBeDefined();

    rerender(<ChaosControls mode="drift" onChange={() => undefined} />);
    expect(screen.getByText(/stopped with both amounts shown/)).toBeDefined();
  });
});

describe("chaos in the stream URL", () => {
  const query = {
    destination: "Lisbon",
    checkIn: "2026-09-01",
    checkOut: "2026-09-04",
    guests: 2,
  };

  it("is absent when not requested", () => {
    expect(searchStreamUrl("http://api.test", query)).not.toContain("chaos");
  });

  it("travels as a query parameter, because EventSource cannot set headers", () => {
    expect(searchStreamUrl("http://api.test", query, "fail")).toContain("chaos=fail");
  });

  it("changes the URL, so switching modes re-runs the search", () => {
    expect(searchStreamUrl("http://api.test", query, "fail")).not.toBe(
      searchStreamUrl("http://api.test", query, "drift"),
    );
  });
});

describe("RecentBookings", () => {
  function booking(overrides: Partial<RecentBooking> = {}): RecentBooking {
    return {
      id: "b1",
      status: "CONFIRMED",
      hotelName: "Grand Meridian Lisbon",
      city: "Lisbon",
      checkIn: "2026-09-01",
      nights: 3,
      total: fromMinor(38970, "EUR"),
      guestName: "Ada Lovelace",
      ...overrides,
    };
  }

  it("renders nothing at all when there are none", () => {
    // No empty state: a heading over an empty list is worse than no section.
    const { container } = render(<RecentBookings bookings={[]} />);

    expect(container.firstChild).toBeNull();
  });

  it("links each booking so a lost link can be recovered", () => {
    render(<RecentBookings bookings={[booking({ id: "abc-123" })]} />);

    expect(screen.getByRole("link").getAttribute("href")).toBe("/bookings/abc-123");
  });

  it("shows the status and total", () => {
    render(<RecentBookings bookings={[booking()]} />);

    expect(screen.getByText("CONFIRMED")).toBeDefined();
    expect(screen.getByText("€389.70")).toBeDefined();
  });
});
