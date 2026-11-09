/**
 * B6b · motion system.
 *
 * Motion is editing language: hard cuts by default, and only five prototypes
 * (feedback, state change, view transition, process, narrative). The product
 * follows the system "reduce motion" setting; the manual tiers exist as
 * `html[data-motion="full|reduced|off"]` for review/future settings.
 *
 * Only `transform` and `opacity` are animated. The single shared-element
 * transition is home card → detail poster; its rectangles are measured rather
 * than hard-coded, and `will-change` lives only on the flight clone.
 */

export type MotionMode = "full" | "reduced" | "off";

export function motionMode(): MotionMode {
  const manual = document.documentElement.dataset.motion;
  if (manual === "full" || manual === "reduced" || manual === "off") return manual;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "reduced" : "full";
}

export function motionAllowsTransform(): boolean {
  return motionMode() === "full";
}

/** Read a duration token (e.g. `--mo-3`) from the root style in milliseconds. */
export function motionDuration(token: string, fallback: number): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return fallback;
  return raw.endsWith("ms") ? value : value * 1000;
}

export interface FlightSource {
  rect: DOMRect;
  clone: HTMLElement;
}

interface ActiveFlight {
  clone: HTMLElement;
  target: HTMLElement;
  timer: number;
  finish: () => void;
}

let activeFlight: ActiveFlight | undefined;

function stripIds(element: HTMLElement): void {
  element.removeAttribute("id");
  element.querySelectorAll("[id]").forEach((child) => child.removeAttribute("id"));
}

/** Snapshot the visual box and content of a poster before its view is hidden. */
export function captureFlightSource(element: HTMLElement | null | undefined): FlightSource | undefined {
  if (!element || motionMode() !== "full") return undefined;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return undefined;
  const clone = element.cloneNode(true) as HTMLElement;
  stripIds(clone);
  clone.removeAttribute("data-artwork-media-id");
  clone.removeAttribute("data-artwork-kind");
  return { rect, clone };
}

/** Finish an in-flight transition immediately and reveal its target. */
export function skipFlight(): void {
  activeFlight?.finish();
  document.querySelectorAll<HTMLElement>("#motion-flight").forEach((element) => element.remove());
  document.querySelectorAll<HTMLElement>(".mo-flight-target").forEach((element) => element.classList.remove("mo-flight-target"));
}

/**
 * Animate the captured poster from its old rectangle to the target rectangle.
 * Returns false when motion is off/reduced or the target has no usable box.
 */
export function startFlight(source: FlightSource | undefined, target: HTMLElement | null | undefined, durationMs: number): boolean {
  if (!source || !target || motionMode() !== "full") return false;
  const to = target.getBoundingClientRect();
  if (to.width <= 0 || to.height <= 0) return false;
  skipFlight();

  const { rect: from, clone } = source;
  clone.id = "motion-flight";
  clone.classList.remove("mo-first-content", "mo-count-rise", "mo-player-in");
  clone.style.left = `${from.left}px`;
  clone.style.top = `${from.top}px`;
  clone.style.width = `${from.width}px`;
  clone.style.height = `${from.height}px`;
  clone.style.transformOrigin = "top left";
  clone.style.transform = "translate(0px, 0px) scale(1, 1)";
  clone.style.willChange = "transform";
  clone.style.transition = `transform ${durationMs}ms var(--ease-out)`;
  target.classList.add("mo-flight-target");
  document.body.append(clone);

  // Force the initial transform to be computed before the final one so the
  // browser starts a real transition instead of jumping.
  void clone.offsetWidth;
  const dx = to.left - from.left;
  const dy = to.top - from.top;
  const sx = to.width / from.width;
  const sy = to.height / from.height;
  clone.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    window.clearTimeout(timer);
    clone.removeEventListener("transitionend", onEnd);
    clone.remove();
    target.classList.remove("mo-flight-target");
    if (activeFlight?.finish === finish) activeFlight = undefined;
  };
  const onEnd = (event: TransitionEvent) => {
    if (event.target === clone && event.propertyName === "transform") finish();
  };
  const timer = window.setTimeout(finish, durationMs + 80);
  clone.addEventListener("transitionend", onEnd);
  activeFlight = { clone, target, timer, finish };
  return true;
}

/**
 * Reveal a view with an opacity-only transition. Reduced motion shortens it to
 * the 140ms token; off is instant. This never gates playback or navigation.
 */
export function fadeIn(element: HTMLElement | null | undefined, durationMs: number): void {
  if (!element) return;
  const mode = motionMode();
  if (mode === "off") return;
  const duration = mode === "reduced" ? Math.min(durationMs, motionDuration("--mo-2", 140)) : durationMs;
  element.style.transition = "none";
  element.style.opacity = "0";
  void element.offsetWidth;
  element.style.transition = `opacity ${duration}ms var(--ease-out)`;
  element.style.opacity = "1";
  window.setTimeout(() => {
    element.style.removeProperty("transition");
    element.style.removeProperty("opacity");
  }, duration + 80);
}
