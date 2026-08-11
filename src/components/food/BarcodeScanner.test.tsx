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

/**
 * Bugfix (2026-08-10): a real, reproduced crash. `Html5Qrcode.stop()` throws SYNCHRONOUSLY --
 * not a rejected promise -- when called on a scanner that hasn't reached the "running/paused"
 * state yet (e.g. the browser's own camera-permission prompt is still pending, so `start()`'s
 * promise hasn't resolved). The old code's `.stop().catch(() => {})` only guards an async
 * rejection; a synchronous throw propagates straight past it as an uncaught error. Reproduced live
 * by Jeff: start a camera scan, switch to manual entry before the permission prompt resolves, and
 * submit -- unmounting the scanner crashed the page with "Cannot stop, scanner is not running or
 * paused." These tests mock `stop()` to throw exactly that shape (synchronously, matching the real
 * library), not `mockRejectedValue` (which is a rejected PROMISE, the case that already worked).
 */
describe("BarcodeScanner: stop() called before start() has resolved", () => {
  function throwNotRunning(): never {
    throw new Error("Cannot stop, scanner is not running or paused.");
  }

  it("stopping via unmount WHILE start() is still pending does not crash", async () => {
    let resolveStart!: () => void;
    const pendingStart = new Promise<void>((resolve) => {
      resolveStart = resolve;
    });
    startMock.mockReturnValueOnce(pendingStart);
    stopMock.mockImplementationOnce(throwNotRunning);

    const { unmount } = render(<BarcodeScanner onSubmitBarcode={vi.fn()} />);
    const scanButton = await screen.findByRole("button", { name: "Scan with camera" });
    fireEvent.click(scanButton);
    await waitFor(() => expect(startMock).toHaveBeenCalledTimes(1));

    // start() has NOT resolved yet -- this is the exact window the real permission prompt leaves
    // open. Unmounting here is what crashed before the fix.
    expect(() => unmount()).not.toThrow();

    // Let the still-pending start() resolve after unmount, to make sure nothing else throws
    // asynchronously either (e.g. an unhandled promise rejection surfacing as a test failure).
    resolveStart();
    await pendingStart;
  });

  it("clicking 'Stop scanning' WHILE start() is still pending does not crash", async () => {
    let resolveStart!: () => void;
    const pendingStart = new Promise<void>((resolve) => {
      resolveStart = resolve;
    });
    startMock.mockReturnValueOnce(pendingStart);
    stopMock.mockImplementationOnce(throwNotRunning);

    render(<BarcodeScanner onSubmitBarcode={vi.fn()} />);
    const scanButton = await screen.findByRole("button", { name: "Scan with camera" });
    fireEvent.click(scanButton);
    await waitFor(() => expect(startMock).toHaveBeenCalledTimes(1));

    const stopButton = await screen.findByRole("button", { name: "Stop scanning" });
    expect(() => fireEvent.click(stopButton)).not.toThrow();
    // Back to the pre-scan UI -- the button click's own state update wasn't blocked by the throw.
    expect(await screen.findByRole("button", { name: "Scan with camera" })).toBeInTheDocument();

    resolveStart();
    await pendingStart;
  });

  it("if start() resolves AFTER a stop was requested, the camera is still stopped for real (not left running)", async () => {
    let resolveStart!: () => void;
    const pendingStart = new Promise<void>((resolve) => {
      resolveStart = resolve;
    });
    startMock.mockReturnValueOnce(pendingStart);
    // The FIRST stop() call (racing the pending start) throws "not running yet", exactly like the
    // real library; a SECOND stop() call, made once start() actually resolves, must go through.
    stopMock.mockImplementationOnce(throwNotRunning).mockResolvedValueOnce(undefined);

    const { unmount } = render(<BarcodeScanner onSubmitBarcode={vi.fn()} />);
    const scanButton = await screen.findByRole("button", { name: "Scan with camera" });
    fireEvent.click(scanButton);
    await waitFor(() => expect(startMock).toHaveBeenCalledTimes(1));

    unmount();
    expect(stopMock).toHaveBeenCalledTimes(1); // the racing call, which threw and was swallowed.

    // Now start() actually resolves -- the camera is genuinely running. Without the
    // stop-requested tracking, nothing would ever call stop() again and the camera would be left
    // running in the background.
    resolveStart();
    await pendingStart;
    await waitFor(() => expect(stopMock).toHaveBeenCalledTimes(2));
  });
});
