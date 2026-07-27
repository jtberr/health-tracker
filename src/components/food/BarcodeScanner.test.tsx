import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BarcodeScanner } from "./BarcodeScanner";

/**
 * qa-reviewer N-6: `startScanning` used to construct `new Html5Qrcode(regionId)` right after
 * `await import("html5-qrcode")`, relying on React having already committed the DOM (with the
 * target `<div id={regionId}>` present) by the time that promise resolved -- not a guaranteed
 * ordering. The fix moves construction into a `useEffect` keyed on `scanning`, so it only ever
 * runs after React has committed a render where that div exists. This test proves exactly that
 * invariant: whenever `Html5Qrcode` is constructed, `document.getElementById(regionId)` must
 * already resolve to a real element.
 */

const startMock = vi.fn().mockResolvedValue(undefined);
const stopMock = vi.fn().mockResolvedValue(undefined);
let regionPresentAtConstruction: boolean | null = null;
let constructedId: string | null = null;

vi.mock("html5-qrcode", () => ({
  // A real `function` (not an arrow function) is required here: vi.fn()'s mock implementation is
  // invoked with `new` by the component under test, and arrow functions can't be constructors.
  Html5Qrcode: vi.fn().mockImplementation(function (id: string) {
    constructedId = id;
    regionPresentAtConstruction = document.getElementById(id) !== null;
    return { start: startMock, stop: stopMock };
  }),
}));

beforeEach(() => {
  startMock.mockClear();
  stopMock.mockClear();
  regionPresentAtConstruction = null;
  constructedId = null;
  Object.defineProperty(window.navigator, "mediaDevices", {
    value: { getUserMedia: vi.fn() },
    configurable: true,
  });
});

describe("BarcodeScanner camera start", () => {
  it("only constructs Html5Qrcode after the region div has committed to the DOM (N-6)", async () => {
    render(<BarcodeScanner onSubmitBarcode={vi.fn()} />);

    const scanButton = await screen.findByRole("button", { name: "Scan with camera" });
    fireEvent.click(scanButton);

    await waitFor(() => expect(startMock).toHaveBeenCalledTimes(1));

    expect(constructedId).toMatch(/^barcode-scanner-region-/);
    expect(regionPresentAtConstruction).toBe(true);
  });

  it("does not offer 'Scan with camera' when no camera API is present", async () => {
    Object.defineProperty(window.navigator, "mediaDevices", { value: undefined, configurable: true });
    render(<BarcodeScanner onSubmitBarcode={vi.fn()} />);

    // Give the mount-only camera-detection Effect a chance to run before asserting its absence.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole("button", { name: "Scan with camera" })).toBeNull();
  });
});
