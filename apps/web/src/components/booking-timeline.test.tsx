import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { BookingEventView } from "@/lib/booking-api";
import { BookingTimeline, StateMachineLegend } from "./booking-timeline";

function event(
  to: BookingEventView["to"],
  from: BookingEventView["from"] = null,
  transition: string | null = null,
): BookingEventView {
  return { from, to, transition, at: "2026-08-17T10:00:00.000Z" };
}

describe("BookingTimeline", () => {
  it("renders the history in the order it happened", () => {
    render(
      <BookingTimeline
        events={[event("PENDING"), event("CONFIRMED", "PENDING", "confirm")]}
        status="CONFIRMED"
      />,
    );

    const entries = screen.getAllByRole("listitem");
    expect(entries[0]?.textContent).toContain("PENDING");
    expect(entries[1]?.textContent).toContain("CONFIRMED");
  });

  it("names the transition that caused each state", () => {
    render(
      <BookingTimeline
        events={[event("PENDING"), event("CANCELLED", "CONFIRMED", "cancel")]}
        status="CANCELLED"
      />,
    );

    expect(screen.getByText("via cancel")).toBeDefined();
  });

  it("shows no transition for the booking's creation", () => {
    // Nothing transitions *into* PENDING — a booking begins there.
    render(<BookingTimeline events={[event("PENDING")]} status="PENDING" />);

    expect(screen.queryByText(/^via /)).toBeNull();
  });

  it("states what may happen next, from the state machine rather than hardcoded", () => {
    render(<BookingTimeline events={[event("PENDING")]} status="PENDING" />);

    const note = screen.getByText(/Permitted from here/);
    expect(note.textContent).toContain("confirm");
    expect(note.textContent).toContain("fail");
    expect(note.textContent).toContain("cancel");
    expect(note.textContent).not.toContain("refund");
  });

  it("says plainly when a booking can go no further", () => {
    render(
      <BookingTimeline
        events={[event("PENDING"), event("FAILED", "PENDING", "fail")]}
        status="FAILED"
      />,
    );

    expect(screen.getByText(/terminal state/)).toBeDefined();
    expect(screen.queryByText(/Permitted from here/)).toBeNull();
  });
});

describe("StateMachineLegend", () => {
  it("shows all five states, not only the ones this booking reached", () => {
    render(<StateMachineLegend status="PENDING" />);

    for (const status of ["PENDING", "CONFIRMED", "CANCELLED", "REFUNDED", "FAILED"]) {
      expect(screen.getByText(new RegExp(status))).toBeDefined();
    }
  });

  it("marks where the booking currently is", () => {
    render(<StateMachineLegend status="CANCELLED" />);

    const current = screen.getByText(/CANCELLED/);
    expect(current.textContent).toContain("← now");
  });

  it("labels terminal states as terminal and others by what they allow", () => {
    render(<StateMachineLegend status="PENDING" />);

    expect(screen.getByText(/REFUNDED/).textContent).toContain("terminal");
    expect(screen.getByText(/CONFIRMED/).textContent).toContain("→ cancel");
  });
});
