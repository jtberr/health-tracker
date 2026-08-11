import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CopyDayDialog } from "./CopyDayDialog";
import { copyFoodEntries } from "@/lib/actions/food";
import type { FoodEntry } from "@/lib/types";

/**
 * Covers `CopyDayDialog`'s new panel-only shape (Phase 8k, "The `/food` day-action surface") --
 * `copyFoodEntries` is mocked, so this exercises the component's own logic (the explanatory text,
 * the default target date, what's actually passed to the action, the defensive empty-day fallback,
 * and that `onCancel` is the sole dismissal path in every state) rather than the real server action
 * (covered elsewhere by `src/lib/actions/food.test.ts`-style integration tests and the e2e suite).
 *
 * This component no longer owns any `open`/visibility state of its own (see the file's own doc
 * comment) -- the caller (`FoodDayView`) mounts/unmounts it entirely, which is exactly why there is
 * no "collapsed trigger" branch left to test here; that's `DayActionBar`'s job now.
 */

vi.mock("@/lib/actions/food", () => ({
  copyFoodEntries: vi.fn(),
}));

const mockedCopyFoodEntries = vi.mocked(copyFoodEntries);

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

describe("CopyDayDialog", () => {
  const onCopied = vi.fn();
  const onCancel = vi.fn();

  beforeEach(() => {
    mockedCopyFoodEntries.mockReset();
    onCopied.mockReset();
    onCancel.mockReset();
  });

  it("names the source day and entry count in its explanatory text", () => {
    const entries = [makeEntry({ id: "a" }), makeEntry({ id: "b" })];
    render(
      <CopyDayDialog
        sourceDate="2026-07-15"
        entries={entries}
        today="2026-07-20"
        tz="UTC"
        onCopied={onCopied}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByText(/Copies all 2 entries from/)).toBeInTheDocument();
    expect(screen.getByText("07/15/2026")).toBeInTheDocument();
  });

  it("singular wording for exactly one entry", () => {
    render(
      <CopyDayDialog
        sourceDate="2026-07-15"
        entries={[makeEntry({ id: "a" })]}
        today="2026-07-20"
        tz="UTC"
        onCopied={onCopied}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByText(/Copies all 1 entry from/)).toBeInTheDocument();
  });

  it("defaults 'Copy to date' to today", () => {
    render(
      <CopyDayDialog
        sourceDate="2026-07-15"
        entries={[makeEntry({ id: "a" })]}
        today="2026-07-20"
        tz="UTC"
        onCopied={onCopied}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByLabelText("Copy to date")).toHaveValue("2026-07-20");
  });

  it("submits every source entry id, the picked date, and the tz -- no toTime (preserves each entry's own time)", async () => {
    mockedCopyFoodEntries.mockResolvedValue({ ok: true, error: null, entries: [] });
    const entries = [makeEntry({ id: "a" }), makeEntry({ id: "b" })];
    render(
      <CopyDayDialog
        sourceDate="2026-07-15"
        entries={entries}
        today="2026-07-20"
        tz="America/Chicago"
        onCopied={onCopied}
        onCancel={onCancel}
      />,
    );
    fireEvent.change(screen.getByLabelText("Copy to date"), { target: { value: "2026-07-18" } });
    fireEvent.click(screen.getByRole("button", { name: "Copy day" }));

    await waitFor(() => expect(mockedCopyFoodEntries).toHaveBeenCalledTimes(1));
    expect(mockedCopyFoodEntries).toHaveBeenCalledWith({
      entryIds: ["a", "b"],
      toDate: "2026-07-18",
      toTz: "America/Chicago",
    });
  });

  it("on success, calls onCopied with the returned entries and the picked date", async () => {
    const returned = [makeEntry({ id: "new-1" })];
    mockedCopyFoodEntries.mockResolvedValue({ ok: true, error: null, entries: returned });
    render(
      <CopyDayDialog
        sourceDate="2026-07-15"
        entries={[makeEntry({ id: "a" })]}
        today="2026-07-20"
        tz="UTC"
        onCopied={onCopied}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy day" }));

    await waitFor(() => expect(onCopied).toHaveBeenCalledTimes(1));
    expect(onCopied).toHaveBeenCalledWith(returned, "2026-07-20");
  });

  it("on a rejected copy, shows a friendly message and never calls onCopied", async () => {
    mockedCopyFoodEntries.mockResolvedValue({ ok: false, error: "future_date" });
    render(
      <CopyDayDialog
        sourceDate="2026-07-15"
        entries={[makeEntry({ id: "a" })]}
        today="2026-07-20"
        tz="UTC"
        onCopied={onCopied}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy day" }));

    await waitFor(() =>
      expect(screen.getByText(/You can.t copy to a date later than today/)).toBeInTheDocument(),
    );
    expect(onCopied).not.toHaveBeenCalled();
  });

  it("never echoes an unrecognized error code or a raw error string verbatim", async () => {
    mockedCopyFoodEntries.mockResolvedValue({ ok: false, error: 'invalid input syntax for type uuid: "x"' });
    render(
      <CopyDayDialog
        sourceDate="2026-07-15"
        entries={[makeEntry({ id: "a" })]}
        today="2026-07-20"
        tz="UTC"
        onCopied={onCopied}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy day" }));

    await waitFor(() => expect(screen.getByText(/Something went wrong/)).toBeInTheDocument());
    expect(screen.queryByText(/invalid input syntax/)).not.toBeInTheDocument();
  });

  it("'Close' calls onCancel -- the sole dismissal control", () => {
    render(
      <CopyDayDialog
        sourceDate="2026-07-15"
        entries={[makeEntry({ id: "a" })]}
        today="2026-07-20"
        tz="UTC"
        onCopied={onCopied}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("defensive fallback: an empty entries list (e.g. the day emptied out from under an already-open panel) renders an explanation and a Close, not a submittable form", () => {
    render(
      <CopyDayDialog sourceDate="2026-07-15" entries={[]} today="2026-07-20" tz="UTC" onCopied={onCopied} onCancel={onCancel} />,
    );
    expect(screen.getByText("There's nothing on this day to copy.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy day" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Copy to date")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
