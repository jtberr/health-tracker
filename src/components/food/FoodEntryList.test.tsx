import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { FoodEntryList } from "./FoodEntryList";
import type { FoodEntry } from "@/lib/types";

/**
 * Covers design doc §3.4 "An active group suppresses its rows' actions and is visually marked" and
 * "Per-row action density on `/food`" (2026-08-05, Phase 8d; SUPERSEDED 2026-08-07, Phase 8g — see
 * `ai-context/DECISIONS.md`'s "Delete returns to the food-entry row..." and "Icons replace
 * buttons+text entirely..."): the row is THREE icon-only actions (Log again/Edit/Delete), none
 * carrying visible text -- each is a real `<button>` with an `aria-label` built from
 * `entryDisplayLabel`; an active group's expander hides that group's own row actions and its
 * header's sibling action, and marks the group's `<section>`; a DIFFERENT group stays fully live;
 * and the header toggle's active label is "Close" (closing the long-deferred duplicate-"Cancel"
 * note). This component never calls `window.confirm` or `deleteFoodEntry` itself -- `onDelete` is
 * a plain caller-supplied callback (see `FoodDayView.handleDelete`'s own coverage for the confirm
 * dialog and the actual mutation, which live outside this component by design).
 *
 * `copyFoodEntries`/`createMealFromEntries` are mocked -- this file exercises FoodEntryList's own
 * suppression/labelling logic, not the real server actions (already covered elsewhere).
 */

vi.mock("@/lib/actions/food", () => ({
  copyFoodEntries: vi.fn(),
}));
vi.mock("@/lib/actions/meals", () => ({
  createMealFromEntries: vi.fn(),
}));

function makeEntry(overrides: Partial<FoodEntry>): FoodEntry {
  return {
    id: overrides.id ?? "entry-1",
    user_id: "user-1",
    name: overrides.name ?? "Eggs",
    quantity: 1,
    unit: null,
    calories_per_unit: 100,
    protein_g_per_unit: 5,
    calories: 100,
    protein_g: 5,
    consumed_at: overrides.consumed_at ?? "2026-07-15T12:00:00.000Z",
    consumed_tz: "UTC",
    consumed_local_date: "2026-07-15",
    logged_from_meal_id: null,
    created_at: "2026-07-15T12:00:00.000Z",
    updated_at: "2026-07-15T12:00:00.000Z",
    ...overrides,
  };
}

const groupA = [makeEntry({ id: "a1", name: "Toast", consumed_at: "2026-07-15T12:00:00.000Z" })];
const groupB = [makeEntry({ id: "b1", name: "Coffee", consumed_at: "2026-07-15T18:00:00.000Z" })];

function baseProps() {
  return {
    entries: [...groupA, ...groupB],
    today: "2026-07-20",
    tz: "UTC",
    onEdit: vi.fn(),
    onLogAgain: vi.fn(),
    onDelete: vi.fn(),
  };
}

describe("FoodEntryList -- row actions (2026-08-07, Phase 8g: icon-only, Delete back on the row)", () => {
  it("each row shows exactly three actions: Log again, Edit and Delete", () => {
    render(<FoodEntryList {...baseProps()} />);
    const row = screen.getByText("Toast").closest("li")!;
    expect(within(row).getByRole("button", { name: /Log again/ })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: /Edit/ })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: /Delete/ })).toBeInTheDocument();
  });

  it("none of the three actions carry visible text -- they're icon-only, named by aria-label", () => {
    render(<FoodEntryList {...baseProps()} />);
    const row = screen.getByText("Toast").closest("li")!;
    for (const verb of ["Log again", "Edit", "Delete"]) {
      const button = within(row).getByRole("button", { name: new RegExp(verb) });
      expect(button.textContent?.trim()).toBe("");
      expect(button).toHaveAttribute("aria-label", `${verb} Toast`);
    }
  });

  it("the aria-label disambiguates by naming the entry (quantity/unit included when set)", () => {
    const qtyEntry = makeEntry({ id: "q1", name: "Rice", quantity: 2, unit: "cup" });
    render(
      <FoodEntryList
        {...baseProps()}
        entries={[qtyEntry]}
      />,
    );
    const row = screen.getByText(/Rice/).closest("li")!;
    expect(within(row).getByRole("button", { name: "Delete 2 cup — Rice" })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Edit 2 cup — Rice" })).toBeInTheDocument();
  });

  it("clicking Delete calls onDelete with the entry -- this component never confirms or deletes itself", () => {
    const onDelete = vi.fn();
    render(<FoodEntryList {...baseProps()} onDelete={onDelete} />);
    const row = screen.getByText("Toast").closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: /Delete/ }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: "a1", name: "Toast" }));
  });

  it("Delete is suppressed exactly where Log again/Edit already are: the edited row, select mode, and an active group", () => {
    const { rerender } = render(<FoodEntryList {...baseProps()} editingEntryId="a1" />);
    let row = screen.getByText("Toast").closest("li")!;
    expect(within(row).queryByRole("button", { name: /Delete/ })).not.toBeInTheDocument();

    rerender(
      <FoodEntryList {...baseProps()} selectMode selectedIds={new Set()} onToggleSelected={vi.fn()} />,
    );
    row = screen.getByText("Toast").closest("li")!;
    expect(within(row).queryByRole("button", { name: /Delete/ })).not.toBeInTheDocument();

    rerender(<FoodEntryList {...baseProps()} />);
    const toastSection = screen.getByText("Toast").closest("section")!;
    fireEvent.click(within(toastSection).getByRole("button", { name: "Copy this group" }));
    row = screen.getByText("Toast").closest("li")!;
    expect(within(row).queryByRole("button", { name: /Delete/ })).not.toBeInTheDocument();
  });
});

describe("FoodEntryList -- editing-row highlight is level 1+ (2026-08-07, Phase 8g: enclosure, not fill)", () => {
  it("the edited row carries the bar, an inset ring, and a FILLED 'Editing' pill -- not the bar-only caption", () => {
    render(<FoodEntryList {...baseProps()} editingEntryId="a1" />);
    const row = screen.getByText("Toast").closest("li")!;
    expect(row.className).toMatch(/border-l-accent/);
    expect(row.className).toMatch(/ring-2/);
    expect(row.className).toMatch(/ring-inset/);
    expect(row.className).toMatch(/ring-accent/);

    const pill = within(row).getByText("Editing");
    expect(pill.className).toMatch(/bg-accent\b/);
    expect(pill.className).toMatch(/text-white/);
  });

  it("a non-edited row carries neither the ring nor the pill", () => {
    render(<FoodEntryList {...baseProps()} editingEntryId="a1" />);
    const coffeeRow = screen.getByText("Coffee").closest("li")!;
    expect(coffeeRow.className).not.toMatch(/ring-accent/);
    expect(within(coffeeRow).queryByText("Editing")).not.toBeInTheDocument();
  });
});

describe("FoodEntryList -- active-group suppression (Phase 8d)", () => {
  it("opening 'Save as meal' on one group hides that group's row actions and the sibling header action", () => {
    render(<FoodEntryList {...baseProps()} />);

    const toastSection = screen.getByText("Toast").closest("section")!;
    fireEvent.click(within(toastSection).getByRole("button", { name: "Save as meal" }));

    // The row's own actions are hidden while this group's expander is open.
    expect(within(toastSection).queryByRole("button", { name: /Log again/ })).not.toBeInTheDocument();
    expect(within(toastSection).queryByRole("button", { name: /Edit/ })).not.toBeInTheDocument();

    // The sibling header action ("Copy this group") is hidden too.
    expect(within(toastSection).queryByRole("button", { name: "Copy this group" })).not.toBeInTheDocument();

    // The active toggle itself stays, but now reads "Close" -- not "Cancel" (closes the long-
    // deferred duplicate-"Cancel" note, Phase 7b N-3 / Phase 8 N-5).
    expect(within(toastSection).getByRole("button", { name: "Close" })).toBeInTheDocument();

    // Exactly one "Cancel" remains in the open panel -- the dialog's own.
    expect(within(toastSection).getAllByRole("button", { name: "Cancel" })).toHaveLength(1);

    // The panel is emphasised and announced: role=region + a visible heading naming the action.
    expect(within(toastSection).getByRole("region", { name: "Save as meal" })).toBeInTheDocument();
  });

  it("a DIFFERENT group's rows stay fully live while one group's expander is open", () => {
    render(<FoodEntryList {...baseProps()} />);

    const toastSection = screen.getByText("Toast").closest("section")!;
    fireEvent.click(within(toastSection).getByRole("button", { name: "Copy this group" }));

    const coffeeSection = screen.getByText("Coffee").closest("section")!;
    expect(within(coffeeSection).getByRole("button", { name: /Log again/ })).toBeInTheDocument();
    expect(within(coffeeSection).getByRole("button", { name: /Edit/ })).toBeInTheDocument();
    expect(within(coffeeSection).getByRole("button", { name: "Save as meal" })).toBeInTheDocument();
    expect(within(coffeeSection).getByRole("button", { name: "Copy this group" })).toBeInTheDocument();
  });

  it("the active group's <section> carries the level-1 accent; an inactive group does not", () => {
    render(<FoodEntryList {...baseProps()} />);

    const toastSection = screen.getByText("Toast").closest("section")!;
    const coffeeSection = screen.getByText("Coffee").closest("section")!;
    expect(toastSection.className).not.toMatch(/border-l-accent/);

    fireEvent.click(within(toastSection).getByRole("button", { name: "Copy this group" }));

    expect(toastSection.className).toMatch(/border-l-accent/);
    expect(coffeeSection.className).not.toMatch(/border-l-accent/);
  });

  it("closing the active panel (via 'Close') restores both header actions and the row actions", () => {
    render(<FoodEntryList {...baseProps()} />);

    const toastSection = screen.getByText("Toast").closest("section")!;
    fireEvent.click(within(toastSection).getByRole("button", { name: "Save as meal" }));
    fireEvent.click(within(toastSection).getByRole("button", { name: "Close" }));

    expect(within(toastSection).getByRole("button", { name: "Save as meal" })).toBeInTheDocument();
    expect(within(toastSection).getByRole("button", { name: "Copy this group" })).toBeInTheDocument();
    expect(within(toastSection).getByRole("button", { name: /Log again/ })).toBeInTheDocument();
    expect(within(toastSection).getByRole("button", { name: /Edit/ })).toBeInTheDocument();
  });
});

describe("FoodEntryList -- select mode / editing still suppress row actions (Phase 8b, unchanged)", () => {
  it("select mode hides row actions and shows a checkbox instead", () => {
    render(
      <FoodEntryList {...baseProps()} selectMode selectedIds={new Set()} onToggleSelected={vi.fn()} />,
    );
    const row = screen.getByText("Toast").closest("li")!;
    expect(within(row).queryByRole("button", { name: /Log again/ })).not.toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: /Edit/ })).not.toBeInTheDocument();
    expect(within(row).getByRole("checkbox")).toBeInTheDocument();
  });

  it("the row currently being edited hides its own actions and shows the 'Editing' label", () => {
    render(<FoodEntryList {...baseProps()} editingEntryId="a1" />);
    const row = screen.getByText("Toast").closest("li")!;
    expect(within(row).getByText("Editing")).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: /Log again/ })).not.toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: /Edit/ })).not.toBeInTheDocument();
  });
});
