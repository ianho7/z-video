/**
 * Shared application listbox used by library sorting and the player's speed,
 * audio and subtitle choices. The same DOM contract is mirrored into the
 * player overlay, where key events are forwarded back to this controller.
 */
export interface AppListboxOption {
  id: string;
  label: string;
  value: string;
  selected: boolean;
}

export interface AppListboxHooks {
  /** Called after the option is chosen and before the popover closes. */
  onSelect?: (value: string, option: AppListboxOption) => void;
  onOpen?: (focusId: string | undefined) => void;
  onClose?: (returnFocus: boolean) => void;
  onFocusChange?: (focusId: string | undefined) => void;
}

type OpenPlacement = "current" | "first" | "last";

let activeListbox: AppListbox | undefined;

export class AppListbox {
  private readonly container: HTMLElement;
  private readonly trigger: HTMLButtonElement;
  private readonly popover: HTMLElement;
  private readonly getOptions: () => AppListboxOption[];
  private readonly hooks: AppListboxHooks;
  private focusIndex = 0;
  private opened = false;

  constructor(config: {
    container: HTMLElement;
    trigger: HTMLButtonElement;
    popover: HTMLElement;
    getOptions: () => AppListboxOption[];
    hooks?: AppListboxHooks;
  }) {
    this.container = config.container;
    this.trigger = config.trigger;
    this.popover = config.popover;
    this.getOptions = config.getOptions;
    this.hooks = config.hooks ?? {};
    this.trigger.addEventListener("click", () => {
      if (this.opened) this.close(true);
      else this.open("current");
    });
    this.trigger.addEventListener("keydown", (event) => this.handleTriggerKey(event));
    this.popover.addEventListener("click", (event) => {
      const option = (event.target as Element | null)?.closest<HTMLButtonElement>('[role="option"]');
      if (option) this.choose(option);
    });
    this.popover.addEventListener("keydown", (event) => this.handleOptionKey(event));
    document.addEventListener("pointerdown", (event) => {
      if (!this.opened) return;
      const target = event.target;
      if (target instanceof Node && this.container.contains(target)) return;
      this.close(false);
    }, true);
  }

  get isOpen(): boolean {
    return this.opened;
  }

  get activeOptionId(): string | undefined {
    return this.optionElements()[this.focusIndex]?.id;
  }

  render(): void {
    const options = this.getOptions();
    this.popover.replaceChildren(...options.map((option) => this.optionElement(option)));
    this.focusIndex = Math.min(this.focusIndex, Math.max(0, options.length - 1));
  }

  /** Keep aria-selected in sync while the popover is closed. */
  syncSelection(): void {
    const options = this.getOptions();
    this.optionElements().forEach((element, index) => {
      const option = options[index];
      if (option) element.setAttribute("aria-selected", String(option.selected));
    });
  }

  open(placement: OpenPlacement = "current"): void {
    if (activeListbox && activeListbox !== this) activeListbox.close(false);
    activeListbox = this;
    this.render();
    const options = this.optionElements();
    if (!options.length) return;
    const selected = options.findIndex((option) => option.getAttribute("aria-selected") === "true");
    const index = placement === "last" ? options.length - 1 : placement === "first" ? 0 : selected >= 0 ? selected : 0;
    this.opened = true;
    this.popover.hidden = false;
    this.trigger.setAttribute("aria-expanded", "true");
    this.fitToViewport();
    this.focusOption(index);
    this.hooks.onOpen?.(options[index]?.id);
  }

  close(returnFocus = true): void {
    if (!this.opened) {
      if (activeListbox === this) activeListbox = undefined;
      return;
    }
    this.opened = false;
    this.popover.hidden = true;
    this.popover.style.removeProperty("max-height");
    this.trigger.setAttribute("aria-expanded", "false");
    if (activeListbox === this) activeListbox = undefined;
    if (returnFocus) this.trigger.focus();
    this.hooks.onFocusChange?.(returnFocus ? this.trigger.id : undefined);
    this.hooks.onClose?.(returnFocus);
  }

  moveFocus(key: string): boolean {
    if (!this.opened) return false;
    const options = this.optionElements();
    if (!options.length) return false;
    const current = Math.min(Math.max(0, this.focusIndex), options.length - 1);
    let next = current;
    if (key === "ArrowDown") next = (current + 1) % options.length;
    else if (key === "ArrowUp") next = (current - 1 + options.length) % options.length;
    else if (key === "Home") next = 0;
    else if (key === "End") next = options.length - 1;
    else return false;
    this.focusOption(next);
    return true;
  }

  activateFocused(): boolean {
    if (!this.opened) return false;
    const option = this.optionElements()[this.focusIndex];
    if (!option) return false;
    this.choose(option);
    return true;
  }

  private fitToViewport(): void {
    this.popover.style.removeProperty("max-height");
    const box = this.popover.getBoundingClientRect();
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
    if (box.height <= 0) return;
    if (this.container.dataset.place === "up") {
      if (box.top < 8) this.popover.style.maxHeight = `${Math.max(120, this.trigger.getBoundingClientRect().top - 16)}px`;
      return;
    }
    if (box.bottom > viewportHeight - 8) {
      this.popover.style.maxHeight = `${Math.max(120, viewportHeight - box.top - 8)}px`;
    }
  }

  private optionElements(): HTMLButtonElement[] {
    return Array.from(this.popover.querySelectorAll<HTMLButtonElement>('[role="option"]'));
  }

  private optionElement(option: AppListboxOption): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.id = option.id;
    button.className = "app-menu-option";
    button.dataset.value = option.value;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(option.selected));
    button.tabIndex = -1;
    button.textContent = option.label;
    return button;
  }

  private focusOption(index: number): void {
    const options = this.optionElements();
    if (!options.length) return;
    this.focusIndex = Math.min(Math.max(0, index), options.length - 1);
    const option = options[this.focusIndex];
    option?.focus();
    this.hooks.onFocusChange?.(option?.id);
  }

  private choose(option: HTMLButtonElement): void {
    if (!this.opened) return;
    const value = option.dataset.value ?? "";
    const selected = this.getOptions().find((candidate) => candidate.id === option.id);
    this.hooks.onSelect?.(value, selected ?? { id: option.id, label: option.textContent ?? "", value, selected: false });
    this.close(true);
  }

  private handleTriggerKey(event: KeyboardEvent): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      this.open(event.key === "ArrowDown" ? "first" : "last");
      return;
    }
    if (event.key === "Escape" && this.opened) {
      event.preventDefault();
      this.close(true);
    }
  }

  private handleOptionKey(event: KeyboardEvent): void {
    if (!this.opened) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      this.activateFocused();
      return;
    }
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      this.close(true);
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      this.moveFocus(event.key);
    }
  }
}
