"use client";

import { useState, type KeyboardEvent } from "react";
import type { FoodCandidate } from "@/lib/domain/lookup";
import { lookupTimeoutSignal } from "@/lib/lookup/timeout";
import { Button } from "@/components/ui/Button";
import { errorTextClass, inputClass, labelClass } from "@/components/ui/styles";
import { BarcodeScanner } from "./BarcodeScanner";

export type FoodLookupPanelProps = {
  /** Called with the picked candidate — the caller (`FoodEntryForm`) prefills + auto-expands. */
  onPick: (candidate: FoodCandidate) => void;
};

type Tab = "search" | "barcode";
type LookupStatus = "idle" | "loading" | "error" | "empty" | "results";

/**
 * Barcode + description-search UI (design doc §3.1 `food/FoodLookupPanel.tsx`), embedded directly
 * inside `FoodEntryForm`. Both tabs call this app's own auth-gated Route Handlers
 * (`/api/lookup/search`, `/api/lookup/barcode`) — never a third-party API directly from this
 * client component, per AGENTS.md's "What Not To Do". Picking a result is a **prefill for
 * review, never an auto-submit**: `onPick` only fills the form's fields (and auto-expands the
 * "add detail" section); the user still explicitly presses "Add entry" themselves.
 *
 * Collapsed by default (an optional expander, matching `FoodEntryForm`'s own progressive-
 * disclosure convention) so a quick manual log never has to look at this panel at all.
 */
export function FoodLookupPanel({ onPick }: FoodLookupPanelProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("search");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<LookupStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [results, setResults] = useState<FoodCandidate[]>([]);

  async function runSearch() {
    const trimmed = query.trim();
    if (!trimmed) return;

    setStatus("loading");
    setErrorMessage(null);
    try {
      const response = await fetch(`/api/lookup/search?query=${encodeURIComponent(trimmed)}`, {
        signal: lookupTimeoutSignal(),
      });
      if (response.status === 401) {
        setStatus("error");
        setErrorMessage("Please sign in again to search.");
        return;
      }
      if (response.status === 429) {
        setStatus("error");
        setErrorMessage("Too many searches in a short time — wait a moment and try again, or enter the food manually below.");
        return;
      }
      if (!response.ok) {
        setStatus("error");
        setErrorMessage("Search is unavailable right now — enter the food manually below.");
        return;
      }
      const body = (await response.json()) as { candidates?: FoodCandidate[] };
      const candidates = body.candidates ?? [];
      setResults(candidates);
      setStatus(candidates.length > 0 ? "results" : "empty");
    } catch {
      setStatus("error");
      setErrorMessage("Search is unavailable right now — enter the food manually below.");
    }
  }

  async function runBarcodeLookup(barcode: string) {
    setStatus("loading");
    setErrorMessage(null);
    setResults([]);
    try {
      const response = await fetch(`/api/lookup/barcode?barcode=${encodeURIComponent(barcode)}`, {
        signal: lookupTimeoutSignal(),
      });
      if (response.status === 401) {
        setStatus("error");
        setErrorMessage("Please sign in again to look up a barcode.");
        return;
      }
      if (response.status === 400) {
        setStatus("error");
        setErrorMessage("That doesn't look like a valid barcode.");
        return;
      }
      if (!response.ok) {
        setStatus("error");
        setErrorMessage("Barcode lookup is unavailable right now — enter the food manually below.");
        return;
      }
      const body = (await response.json()) as { candidate: FoodCandidate | null };
      if (body.candidate) {
        setResults([body.candidate]);
        setStatus("results");
      } else {
        setResults([]);
        setStatus("empty");
      }
    } catch {
      setStatus("error");
      setErrorMessage("Barcode lookup is unavailable right now — enter the food manually below.");
    }
  }

  function handlePick(candidate: FoodCandidate) {
    onPick(candidate);
    setOpen(false);
    setResults([]);
    setStatus("idle");
    setQuery("");
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start text-sm font-medium text-sage-deep hover:text-sage-deep/80"
      >
        Look up a food (barcode or search)
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg bg-stone-50 p-3.5">
      <div className="flex items-center justify-between">
        <div className="flex gap-1" role="tablist" aria-label="Food lookup method">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "search"}
            onClick={() => setTab("search")}
            className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
              tab === "search" ? "bg-sage-pale text-ink" : "text-stone-600 hover:bg-stone-100"
            }`}
          >
            Search
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "barcode"}
            onClick={() => setTab("barcode")}
            className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
              tab === "barcode" ? "bg-sage-pale text-ink" : "text-stone-600 hover:bg-stone-100"
            }`}
          >
            Barcode
          </button>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm font-medium text-stone-500 hover:text-stone-700"
        >
          Close
        </button>
      </div>

      {tab === "search" ? (
        // A plain `<div>`, NOT a nested `<form>`: this whole panel lives inside
        // `FoodEntryForm`'s own `<form>`, and HTML forbids nested forms (a browser silently
        // flattens/ignores the inner one, so a "submit" button here would actually submit the
        // *outer* food-entry form instead of running this search) -- confirmed by hand in a
        // real browser, not just inferred. Enter-to-search is preserved via onKeyDown instead.
        <div className="flex items-end gap-2">
          {/* min-w-0 overrides the flex item default of min-width:auto, which otherwise refuses
              to shrink below the <input>'s natural content width and pushes the Search button
              outside the card on narrow (phone) viewports. */}
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor="food-lookup-query" className={labelClass}>
              Search by description
            </label>
            <input
              id="food-lookup-query"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  runSearch();
                }
              }}
              placeholder="e.g. grilled chicken breast"
              className={inputClass}
            />
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={runSearch}
            disabled={!query.trim() || status === "loading"}
          >
            Search
          </Button>
        </div>
      ) : (
        <BarcodeScanner onSubmitBarcode={runBarcodeLookup} disabled={status === "loading"} />
      )}

      {status === "loading" && <p className="text-sm text-stone-500">Looking up…</p>}
      {status === "error" && errorMessage && <p className={errorTextClass}>{errorMessage}</p>}
      {status === "empty" && (
        <p className="text-sm text-stone-500">No match found — enter the details manually below.</p>
      )}

      {status === "results" && results.length > 0 && (
        <ul className="flex flex-col gap-2">
          {results.map((candidate, index) => (
            // qa-reviewer N-5: `sourceId` falls back to the candidate's own description when a
            // provider omits a real id (e.g. USDA with no `fdcId`), so two same-named results can
            // collide on `source-sourceId` alone. The result list's own array index is stable for
            // a single render of one search/lookup response, so folding it in makes the key
            // collision-proof for this list without needing a hash of the full candidate.
            <li
              key={`${candidate.source}-${candidate.sourceId}-${index}`}
              className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 bg-white px-3 py-2"
            >
              <div className="flex flex-col">
                <span className="text-sm font-medium text-ink">{candidate.name}</span>
                <span className="text-xs text-stone-500">
                  {candidate.quantity} {candidate.unit ?? "unit"} — {Math.round(candidate.caloriesPerUnit)} kcal /{" "}
                  {Math.round(candidate.proteinGPerUnit * 10) / 10} g protein
                </span>
              </div>
              <Button type="button" size="sm" variant="secondary" onClick={() => handlePick(candidate)}>
                Use this
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
