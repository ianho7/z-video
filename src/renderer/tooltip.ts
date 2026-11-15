/**
 * Ticket 21 · app-drawn hover hints replace native `title` tooltips.
 *
 * Every trigger carries `data-tooltip`; keyboard and pointer focus use the same
 * single tooltip node so the app never falls back to the OS bubble. Text is
 * rendered only while the trigger is hovered or focused, and the node is
 * removed from the accessibility tree by `hidden` otherwise. Screen-reader
 * copy lives in `aria-describedby`/`aria-keyshortcuts`, not here.
 */
export function initAppTooltips(): void {
  const host = document.querySelector<HTMLElement>("#app-tooltip");
  if (!host) return;
  let active: HTMLElement | null = null;

  const hide = (): void => {
    active = null;
    host.hidden = true;
    host.textContent = "";
  };

  const place = (element: HTMLElement, trigger: HTMLElement): void => {
    host.style.top = "0px";
    host.style.left = "0px";
    const size = host.getBoundingClientRect();
    const anchor = trigger.getBoundingClientRect();
    const maxLeft = Math.max(8, window.innerWidth - size.width - 8);
    const centered = anchor.left + anchor.width / 2 - size.width / 2;
    const above = anchor.top - size.height - 8;
    const below = anchor.bottom + 8;
    const top = above >= 8 ? above : Math.min(below, Math.max(8, window.innerHeight - size.height - 8));
    element.style.left = `${Math.round(Math.max(8, Math.min(centered, maxLeft)))}px`;
    element.style.top = `${Math.round(top)}px`;
  };

  const show = (trigger: HTMLElement): void => {
    const text = trigger.dataset.tooltip?.trim();
    if (!text) return;
    active = trigger;
    host.textContent = text;
    host.hidden = false;
    place(host, trigger);
  };

  const triggerFrom = (target: EventTarget | null): HTMLElement | null => {
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
