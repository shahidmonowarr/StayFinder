import { dedupeKeyFor, fromMinor, type HotelOption, type SupplierId } from "@stayfinder/shared";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ResultsList } from "./results-list";

function option(
  supplier: SupplierId,
  name: string,
  totalMinor: number,
  refundable = true,
): HotelOption {
  return {
    id: `${supplier}:${name}`,
    supplier,
    supplierHotelId: name,
    name,
    city: "Lisbon",
    starRating: 4,
    nightlyRate: fromMinor(Math.round(totalMinor / 3), "EUR"),
    totalPrice: fromMinor(totalMinor, "EUR"),
    checkIn: "2026-09-01",
    checkOut: "2026-09-04",
    nights: 3,
    guests: 2,
    refundable,
    dedupeKey: dedupeKeyFor({ name, city: "Lisbon" }),
  };
}

describe("ResultsList", () => {
  it("shows skeletons while waiting with nothing yet", () => {
    render(<ResultsList options={[]} waiting />);

    expect(screen.getByTestId("skeletons")).toBeDefined();
  });

  it("explains an empty result set rather than showing a blank page", () => {
    render(<ResultsList options={[]} waiting={false} />);

    expect(screen.getByText(/No rooms came back/)).toBeDefined();
  });

  it("collapses one property sold by three suppliers into a single card", () => {
    render(
      <ResultsList
        options={[
          option("alpha", "Grand Meridian Lisbon", 38970),
          option("beta", "Grand Meridian, Lisbon", 37500),
          option("gamma", "GRAND MERIDIAN LISBON", 40500),
        ]}
        waiting={false}
      />,
    );

    expect(screen.getByText("1 property · 3 offers")).toBeDefined();
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(1);
  });

  it("shows every supplier's offer without anything to click", () => {
    // The previous design hid these behind an "Also from N other suppliers"
    // toggle — so the most interesting fact in the product was the one you had
    // to go looking for. Both prices are now visible on arrival.
    render(
      <ResultsList
        options={[
          option("alpha", "Grand Meridian Lisbon", 38970, true),
          option("gamma", "GRAND MERIDIAN LISBON", 37000, false),
        ]}
        waiting={false}
      />,
    );

    expect(screen.getByTestId("offer-alpha").textContent).toContain("€389.70");
    expect(screen.getByTestId("offer-gamma").textContent).toContain("€370.00");
    expect(screen.queryByRole("button", { name: /Also from/ })).toBeNull();
  });

  it("marks the cheapest offer and flags the ones that are non-refundable", () => {
    render(
      <ResultsList
        options={[
          option("alpha", "Grand Meridian Lisbon", 38970, true),
          option("gamma", "GRAND MERIDIAN LISBON", 37000, false),
        ]}
        waiting={false}
      />,
    );

    // Gamma is cheaper but non-refundable; both facts have to be readable at once.
    expect(screen.getByTestId("offer-gamma").textContent).toContain("nr");
    expect(screen.getByTestId("offer-alpha").textContent).not.toContain("nr");
    // Twice: once in Gamma's chip, once as the headline. The headline price is
    // the cheapest offer, so those are necessarily the same figure.
    expect(screen.getAllByText("€370.00")).toHaveLength(2);
  });

  it("never shouts a property name back at the user", () => {
    render(
      <ResultsList
        options={[
          option("gamma", "GRAND MERIDIAN LISBON", 37000),
          option("alpha", "Grand Meridian Lisbon", 38970),
        ]}
        waiting={false}
      />,
    );

    expect(screen.getByRole("heading", { level: 3 }).textContent).toBe("Grand Meridian Lisbon");
  });

  it("says the list is still growing while a supplier is outstanding", () => {
    render(<ResultsList options={[option("alpha", "Alfama Boutique", 18300)]} waiting />);

    expect(screen.getByText(/still gathering/)).toBeDefined();
  });
});
