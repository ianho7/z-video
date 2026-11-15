const heading = document.getElementById("overlay-heading");
const stage = document.getElementById("overlay-stage");
const controls = document.getElementById("overlay-controls");
let initialized = false;
let revision = -1;
let lastFocusId;
let state = {};
let timer;
let dragging = false;

// Ticket 21: mirrored player controls carry `data-tooltip`; the overlay window
// draws the same app tooltip instead of a native `title` bubble. Kept in sync
// with src/renderer/tooltip.ts (this window loads a classic script, not modules).
function initAppTooltips() {
  const host = document.getElementById("app-tooltip");
  if (!host) return;
  let active = null;
  const hide = () => {
    active = null;
    host.hidden = true;
    host.textContent = "";
  };
  const place = (trigger) => {
    host.style.top = "0px";
    host.style.left = "0px";
    const size = host.getBoundingClientRect();
    const anchor = trigger.getBoundingClientRect();
    const maxLeft = Math.max(8, window.innerWidth - size.width - 8);
    const centered = anchor.left + anchor.width / 2 - size.width / 2;
    const above = anchor.top - size.height - 8;
    const below = anchor.bottom + 8;
    const top = above >= 8 ? above : Math.min(below, Math.max(8, window.innerHeight - size.height - 8));
    host.style.left = `${Math.round(Math.max(8, Math.min(centered, maxLeft)))}px`;
    host.style.top = `${Math.round(top)}px`;
  };
  const show = (trigger) => {
    const text = trigger.dataset.tooltip?.trim();
    if (!text) return;
    active = trigger;
    host.textContent = text;
    host.hidden = false;
    place(trigger);
  };
  const triggerFrom = (target) => {
    if (!(target instanceof Element)) return null;
    const found = target.closest("[data-tooltip]");
    return found instanceof HTMLElement ? found : null;
  };
  document.addEventListener("pointerover", (event) => {
    const trigger = triggerFrom(event.target);
    if (trigger) show(trigger);
  });
  document.addEventListener("pointerout", (event) => {
    if (!active) return;
    const next = event.relatedTarget;
    if (next instanceof Node && active.contains(next)) return;
    hide();
  });
  document.addEventListener("focusin", (event) => {
    const trigger = triggerFrom(event.target);
    if (trigger) show(trigger);
  });
  document.addEventListener("focusout", () => hide());
  document.addEventListener("pointerdown", () => hide());
  window.addEventListener("scroll", hide, true);
  window.addEventListener("blur", hide);
  window.addEventListener("resize", hide);
}
initAppTooltips();

function isTextEntry(target) {
  return target instanceof Element && Boolean(target.closest("input, textarea, [contenteditable='true']"));
}
document.addEventListener("contextmenu", (event) => event.preventDefault());
document.addEventListener("dragstart", (event) => event.preventDefault());
document.addEventListener("selectstart", (event) => { if (!isTextEntry(event.target)) event.preventDefault(); });

window.zVideo.overlay.onReset(() => {
  clearTimeout(timer);
  timer = undefined;
  dragging = false;
  state = {};
  revision = -1;
  // Ticket 06: the mirrored markup belongs to the session that just ended. A
  // reopened overlay must repaint from the next full state push.
  initialized = false;
  lastFocusId = undefined;
  heading.innerHTML = "";
  controls.innerHTML = "";
  stage.innerHTML = "";
  document.body.classList.remove("overlay-hidden", "fullscreen");
  window.zVideo.overlay.ignore(false);
});

function showControls() {
  document.body.classList.remove("overlay-hidden");
  window.zVideo.overlay.ignore(false);
  clearTimeout(timer);
  if (!state.fullscreen || state.playing !== true || state.error) return;
  timer = setTimeout(() => {
    if (dragging || document.activeElement?.closest("button, input, select") || !document.getElementById("player-settings")?.hidden) return;
    document.body.classList.add("overlay-hidden");
    window.zVideo.overlay.ignore(true);
  }, 3000);
}

window.zVideo.overlay.onState((next) => {
  if (!next || typeof next !== "object") return;
  // Ticket 06: the play/pause edge shares a frame with the error stage, so an
  // error appearing or clearing also counts as a change that reveals controls.
  const changed = state.fullscreen !== next.fullscreen || state.playing !== next.playing || state.activity !== next.activity || Boolean(state.error) !== Boolean(next.error);
  state = next;
  document.body.classList.toggle("fullscreen", !!next.fullscreen);
  const structureChanged = typeof next.revision === "number" && (next.revision !== revision || !initialized);
  if (structureChanged) {
    revision = next.revision;
    if (typeof next.heading === "string") heading.innerHTML = next.heading;
    if (typeof next.controls === "string") controls.innerHTML = next.controls;
    if (typeof next.stage === "string") stage.innerHTML = next.stage;
    initialized = true;
  }
  if (typeof next.focusId === "string" && next.focusId && (next.focusId !== lastFocusId || structureChanged)) {
    lastFocusId = next.focusId;
    document.getElementById(next.focusId)?.focus({ preventScroll: true });
  } else if (!next.focusId) {
    lastFocusId = undefined;
  }
  for (const [id, value] of Object.entries(next.elements || {})) {
    const element = document.getElementById(id);
    if (!element || !value || typeof value !== "object") continue;
    if ("hidden" in value) element.hidden = value.hidden;
    if ("disabled" in value) element.disabled = value.disabled;
    if ("html" in value && element.innerHTML !== value.html) element.innerHTML = value.html;
    if ("value" in value && document.activeElement !== element) element.value = value.value;
    if ("max" in value) element.max = value.max;
    if ("min" in value) element.min = value.min;
    if ("style" in value) element.setAttribute("style", value.style);
    if ("expanded" in value) element.setAttribute("aria-expanded", value.expanded);
    if ("pressed" in value) element.setAttribute("aria-pressed", value.pressed);
    if ("label" in value) element.setAttribute("aria-label", value.label);
  }
  if (!dragging) document.getElementById("player-seek")?.parentElement?.setAttribute("style", next.progress || "");
  if (changed) showControls();
});
for (const type of ["click", "input", "change"]) document.addEventListener(type, (event) => {
  const element = event.target.closest("[id]");
  if (!element) return;
  if (type === "input" && element.id === "player-seek" && Number(element.max) > 0) {
    element.parentElement?.style.setProperty("--progress", `${Number(element.value) / Number(element.max) * 100}%`);
  }
  window.zVideo.overlay.action({ type, id: element.id, value: element.value });
  showControls();
});
document.addEventListener("pointerdown", () => { dragging = true; showControls(); });
window.addEventListener("pointerup", () => { dragging = false; showControls(); });
window.addEventListener("pointercancel", () => { dragging = false; showControls(); });
window.addEventListener("mousemove", (event) => {
  showControls();
  if (!state.fullscreen && event.clientY < 36) window.zVideo.overlay.ignore(true);
});
window.addEventListener("focusout", () => setTimeout(showControls, 0));
window.addEventListener("keydown", (event) => {
  showControls();
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing) return;
  if (document.activeElement?.closest('[role="listbox"]') && ["ArrowDown", "ArrowUp", "Home", "End", "Escape", "Tab"].includes(event.key)) event.preventDefault();
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest("input, select") || (event.code === "Space" && target?.closest("button"))) return;
  window.zVideo.overlay.action({ type: "key", key: event.key, code: event.code });
});
