"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { Html5Qrcode } from "html5-qrcode";
import { Button } from "@/components/ui/Button";
import { errorTextClass, inputClass, labelClass } from "@/components/ui/styles";

export type BarcodeScannerProps = {
  /** Called with a barcode string once resolved, whether typed manually or scanned. */
  onSubmitBarcode: (barcode: string) => void;
  disabled?: boolean;
};

/**
 * Barcode entry/scan UI (design doc §3.1 `food/BarcodeScanner.tsx`). Manual digit entry is the
 * always-available primary path — it works on every device/browser and needs no permissions, so
 * it's rendered unconditionally. An optional "Scan with camera" control layers `html5-qrcode` on
 * top for devices that actually have one, feature-detected via `navigator.mediaDevices
 * .getUserMedia` so a camera-less device/browser never sees a non-functional button. `html5-qrcode`
 * itself is dynamically imported (only when scanning is actually started) so it never bloats the
 * initial bundle for the — expected to be common — manual-entry-only path.
 *
 * This component never calls a third-party API itself — it only ever resolves a barcode *string*
 * and hands it up to the caller (`FoodLookupPanel`), which is the one that calls the auth-gated
 * `/api/lookup/barcode` proxy. Per AGENTS.md's "What Not To Do", no lookup call happens here.
 */
export function BarcodeScanner({ onSubmitBarcode, disabled = false }: BarcodeScannerProps) {
  const idPrefix = useId().replace(/[^a-zA-Z0-9-]/g, "");
  const regionId = `barcode-scanner-region-${idPrefix}`;

  const [manualCode, setManualCode] = useState("");
  const [cameraSupported, setCameraSupported] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);

  // Feature-detect on mount only (never during render/SSR): `navigator` doesn't exist on the
  // server, so computing this synchronously during render would either throw or -- if guarded --
  // always resolve `false` on the server and then mismatch on client hydration the moment a real
  // browser's `navigator.mediaDevices` differs. Deferring to a mount-only Effect (the same pattern
  // `MetricForm`/`TrendsView` use for browser-tz detection) means server and first-client-render
  // agree (both "no camera button yet"), and the button appears only once actually confirmed.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCameraSupported(typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia));
  }, []);

  useEffect(() => {
    // Make sure the camera is never left running in the background past this component's life.
    return () => {
      scannerRef.current?.stop().catch(() => {});
      scannerRef.current = null;
    };
  }, []);

  function handleManualSubmit() {
    const trimmed = manualCode.trim();
    if (!trimmed) return;
    onSubmitBarcode(trimmed);
  }

  function stopScanning() {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    setScanning(false);
    if (scanner) {
      scanner.stop().catch(() => {});
    }
  }

  /** Only flips the state that triggers the camera-start Effect below -- see that Effect's doc
   * comment for why the actual `Html5Qrcode` construction moved out of this function
   * (qa-reviewer N-6). */
  function startScanning() {
    setScanError(null);
    setScanning(true);
  }

  // qa-reviewer N-6: constructing `new Html5Qrcode(regionId)` used to happen directly inside
  // `startScanning`, right after `await import("html5-qrcode")` and a synchronous `setScanning(true)`
  // call -- relying on React having already flushed that state update (and so committed the DOM
  // with the target `<div id={regionId}>` present) by the time the dynamic import's promise
  // resolved. That ordering isn't guaranteed: a state update inside an event handler is only
  // guaranteed to have committed by the next paint/effect, not by an arbitrary later microtask.
  // Keying this Effect on `scanning` makes it deterministic instead: React only runs an Effect
  // after committing the render it belongs to, so the region div is guaranteed to already be in
  // the DOM the first time this Effect's body executes for a given `true` transition.
  useEffect(() => {
    if (!scanning) return;
    let cancelled = false;

    (async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (cancelled) return;
        const scanner = new Html5Qrcode(regionId);
        scannerRef.current = scanner;
        await scanner.start(
          // NOTE: despite its `MediaTrackConstraints` type, html5-qrcode's runtime requires this
          // first argument to be a plain object with EXACTLY one key (`facingMode` or
          // `deviceId`) -- extra keys like `width`/`height` here throw synchronously
          // ("object should have exactly 1 key"), which is why the resolution request has to go
          // through `videoConstraints` in the config argument below instead, not here.
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: { width: 300, height: 150 },
            // Request the highest resolution the camera offers (most default to a low ~640x480
            // stream otherwise) -- a fixed-focus webcam that can't sharply resolve a barcode held
            // close still benefits from more raw pixel detail per unit area to decode against.
            // Setting this replaces (doesn't merge with) the `facingMode` above at the library's
            // own getUserMedia call, so it's repeated here.
            videoConstraints: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
          },
          (decodedText) => {
            setManualCode(decodedText);
            onSubmitBarcode(decodedText);
            stopScanning();
          },
          () => {
            // Fires continuously while no code is in frame yet -- expected, not an error.
          },
        );
      } catch {
        if (cancelled) return;
        setScanError("Couldn't start the camera. Enter the code manually instead.");
        scannerRef.current = null;
        setScanning(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning, regionId]);

  return (
    <div className="flex flex-col gap-3">
      {/* A plain `<div>`, NOT a nested `<form>`: this component lives inside `FoodLookupPanel`,
          itself inside `FoodEntryForm`'s own `<form>`, and HTML forbids nested forms (a browser
          silently flattens/ignores an inner one, so a "submit" button here would actually submit
          the *outer* food-entry form) -- confirmed by hand in a real browser, not just inferred.
          Enter-to-submit is preserved via onKeyDown instead. */}
      <div className="flex items-end gap-2">
        {/* min-w-0 overrides the flex item default of min-width:auto, which otherwise refuses to
            shrink below the <input>'s natural content width and pushes the "Look up" button
            outside the card on narrow (phone) viewports. */}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor={`${idPrefix}-barcode`} className={labelClass}>
            Barcode (UPC/EAN)
          </label>
          <input
            id={`${idPrefix}-barcode`}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleManualSubmit();
              }
            }}
            placeholder="e.g. 012345678905"
            className={inputClass}
            disabled={disabled}
          />
        </div>
        <Button type="button" variant="secondary" onClick={handleManualSubmit} disabled={disabled || !manualCode.trim()}>
          Look up
        </Button>
      </div>

      {cameraSupported && (
        <div className="flex flex-col gap-2">
          {!scanning ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={startScanning}
              disabled={disabled}
              className="self-start"
            >
              Scan with camera
            </Button>
          ) : (
            <div className="flex flex-col gap-2">
              <div id={regionId} className="mx-auto w-full max-w-xs overflow-hidden rounded-lg" />
              <Button type="button" variant="secondary" size="sm" onClick={stopScanning} className="self-start">
                Stop scanning
              </Button>
            </div>
          )}
        </div>
      )}

      {scanError && <p className={errorTextClass}>{scanError}</p>}
    </div>
  );
}
