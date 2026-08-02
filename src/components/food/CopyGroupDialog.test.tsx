import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CopyGroupDialog } from "./CopyGroupDialog";
import { copyFoodEntries } from "@/lib/actions/food";
import type { FoodEntry } from "@/lib/types";

/**
 * Covers the new "Copy to time" override (Finding 4, design doc §3.4) and the parameterized-wording
 * seam Phase 8b added for the multi-select bulk action to reuse this component. `copyFoodEntries`
 * is mocked -- this file exercises the component's own logic (the sentinel default, the
 * singular/plural label, when the disclosure note appears/what it says, and exactly what gets
 * passed to the action), not the real server action (already covered by
 * `src/lib/actions/food.test.ts`-style integration tests and qa-reviewer's e2e suite).
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

describe("CopyGroupDialog -- Copy to time override", () => {
  const onCopied = vi.fn();
  const onCancel = vi.fn();

  beforeEach(() => {
    mockedCopyFoodEntries.mockReset();
    onCopied.mockReset();
    onCancel.mockReset();
  });

  it("defaults the time select to the sentinel, labeled singular for a single-instant group", () => {
    const entries = [makeEntry({ id: "a", consumed_at: "2026-07-15T12:00:00.000Z" })];
    render(
      <CopyGroupDialog entries={entries} today="2026-07-20" tz="UTC" onCopied={onCopied} onCancel={onCancel} />,
    );
    const select = screen.getByLabelText("Copy to time") as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(screen.getByRole("option", { name: "Keep original time" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Keep original times" })).not.toBeInTheDocument();
  });

  it("labels the sentinel plural when the source spans more than one distinct instant", () => {
    const entries = [
      makeEntry({ id: "a", consumed_at: "2026-07-15T12:00:00.000Z" }),
      makeEntry({ id: "b", consumed_at: "2026-07-15T18:00:00.000Z" }),
    ];
    render(
      <CopyGroupDialog entries={entries} today="2026-07-20" tz="UTC" onCopied={onCopied} onCancel={onCancel} />,
    );
    expect(screen.getByRole("option", { name: "Keep original times" })).toBeInTheDocument();
  });

  it("shows no disclosure note for a single-instant group, regardless of what's picked", () => {
    const entries = [makeEntry({ id: "a", consumed_at: "2026-07-15T12:00:00.000Z" })];
    render(
      <CopyGroupDialog entries={entries} today="2026-07-20" tz="UTC" onCopied={onCopied} onCancel={onCancel} />,
    );
    expect(screen.queryByText(/single meal group/)).not.toBeInTheDocument();
    expect(screen.queryByText("Each entry keeps its own time of day.")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Copy to time"), { target: { value: "18:30" } });
    expect(screen.queryByText(/single meal group/)).not.toBeInTheDocument();
  });

  it("discloses the collapse when a multi-instant source picks an explicit time, and the 'keep original' note otherwise", () => {
    const entries = [
      makeEntry({ id: "a", consumed_at: "2026-07-15T12:00:00.000Z" }),
      makeEntry({ id: "b", consumed_at: "2026-07-15T18:00:00.000Z" }),
      makeEntry({ id: "c", consumed_at: "2026-07-15T20:00:00.000Z" }),
    ];
    render(
      <CopyGroupDialog entries={entries} today="2026-07-20" tz="UTC" onCopied={onCopied} onCancel={onCancel} />,
    );

    expect(screen.getByText("Each entry keeps its own time of day.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Copy to time"), { target: { value: "18:30" } });
    expect(
      screen.getByText("All 3 entries will be copied to 06:30 PM as a single meal group."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Each entry keeps its own time of day.")).not.toBeInTheDocument();
  });

  it("submits with toTime undefined when the sentinel is left selected (today's behaviour is the default)", async () => {
    mockedCopyFoodEntries.mockResolvedValue({ ok: true, error: null, entries: [] });
    const entries = [makeEntry({ id: "a" })];
    render(
      <CopyGroupDialog entries={entries} today="2026-07-20" tz="UTC" onCopied={onCopied} onCancel={onCancel} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy group" }));

    await waitFor(() => expect(mockedCopyFoodEntries).toHaveBeenCalledTimes(1));
    expect(mockedCopyFoodEntries).toHaveBeenCalledWith(
      expect.objectContaining({ entryIds: ["a"], toTime: undefined }),
    );
  });

  it("submits the explicitly chosen time when the user picks one", async () => {
    mockedCopyFoodEntries.mockResolvedValue({ ok: true, error: null, entries: [] });
    const entries = [makeEntry({ id: "a" }), makeEntry({ id: "b" })];
    render(
      <CopyGroupDialog entries={entries} today="2026-07-20" tz="UTC" onCopied={onCopied} onCancel={onCancel} />,
    );

    fireEvent.change(screen.getByLabelText("Copy to time"), { target: { value: "08:15" } });
    fireEvent.click(screen.getByRole("button", { name: "Copy group" }));

    await waitFor(() => expect(mockedCopyFoodEntries).toHaveBeenCalledTimes(1));
    expect(mockedCopyFoodEntries).toHaveBeenCalledWith(
      expect.objectContaining({ entryIds: ["a", "b"], toTime: "08:15" }),
    );
  });

  it("respects the parameterized submitLabel and error-message props (Phase 8b bulk-action reuse)", async () => {
    mockedCopyFoodEntries.mockResolvedValue({ ok: false, error: "entries_not_found" });
    const entries = [makeEntry({ id: "a" })];
    render(
      <CopyGroupDialog
        entries={entries}
        today="2026-07-20"
        tz="UTC"
        onCopied={onCopied}
        onCancel={onCancel}
        submitLabel="Copy selected"
        entriesNotFoundMessage="Couldn't find those entries — try reselecting and copying again."
      />,
    );

    expect(screen.getByRole("button", { name: "Copy selected" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy group" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Copy selected" }));

    await waitFor(() =>
      expect(
        screen.getByText("Couldn't find those entries — try reselecting and copying again."),
      ).toBeInTheDocument(),
    );
    expect(onCopied).not.toHaveBeenCalled();
  });

  it("defaults to the byte-identical existing group wording when no override props are given", () => {
    const entries = [makeEntry({ id: "a" })];
    render(
      <CopyGroupDialog entries={entries} today="2026-07-20" tz="UTC" onCopied={onCopied} onCancel={onCancel} />,
    );
    expect(screen.getByRole("button", { name: "Copy group" })).toBeInTheDocument();
  });
});
