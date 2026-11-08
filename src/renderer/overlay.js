const heading = document.getElementById("overlay-heading");
const controls = document.getElementById("overlay-controls");
let initialized = false;
let state = {};
let timer;
let dragging = false;

window.zVideo.overlay.onReset(() => {
  clearTimeout(timer);
  timer = undefined;
  dragging = false;
  state = {};
  document.body.classList.remove("overlay-hidden", "fullscreen");
  window.zVideo.overlay.ignore(false);
});

function showControls() {
  document.body.classList.remove("overlay-hidden");
  window.zVideo.overlay.ignore(false);
  clearTimeout(timer);
  if (!state.fullscreen || state.playing !== true) return;
  timer = setTimeout(() => {
    if (dragging || document.activeElement?.closest("button, input, select") || !document.getElementById("player-settings")?.hidden) return;
    document.body.classList.add("overlay-hidden");
    window.zVideo.overlay.ignore(true);
  }, 3000);
}

window.zVideo.overlay.onState((next) => {
  if (!next || typeof next !== "object") return;
  const changed = state.fullscreen !== next.fullscreen || state.playing !== next.playing || state.activity !== next.activity;
  state = next;
  document.body.classList.toggle("fullscreen", !!next.fullscreen);
  if (!initialized && typeof next.heading === "string" && typeof next.controls === "string") {
    heading.innerHTML = next.heading; controls.innerHTML = next.controls; initialized = true;
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
  if (event.target.closest("input, select") || (event.code === "Space" && event.target.closest("button"))) return;
  window.zVideo.overlay.action({ type: "key", key: event.key, code: event.code });
});
