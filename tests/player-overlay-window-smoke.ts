import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app, BrowserWindow } from "electron";

import { createMainWindow } from "../src/main/window";
import { MainLocalPlaybackHost } from "../src/main/player-host";
import { registerLocalPlaybackIpcHandlers } from "../src/main/local-playback-ipc";
import type { LocalPlaybackStore } from "../src/shared/local-playback-contracts";

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function waitFor(label: string, predicate: () => Promise<boolean>): Promise<void> {
  const end = Date.now() + 10_000;
  while (!(await predicate())) { if (Date.now() > end) throw new Error(`timed out waiting for ${label}`); await delay(100); }
}
async function waitForValue<T>(label: string, read: () => Promise<T>, predicate: (value: T) => boolean): Promise<T> {
  const end = Date.now() + 10_000;
  let value = await read();
  while (!predicate(value)) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}: ${JSON.stringify(value)}`);
    await delay(100);
    value = await read();
  }
  return value;
}

async function run(): Promise<void> {
  app.setPath("userData", await mkdtemp(join(tmpdir(), "z-video-overlay-test-")));
  await app.whenReady();
  const window = createMainWindow();
  const store: LocalPlaybackStore = {
    resolveMediaPath: async () => join(process.cwd(), "assets", "test_video.mp4"),
    getPlayback: async () => undefined,
    savePlayback: async (value) => value,
  };
  const host = new MainLocalPlaybackHost(window, store);
  const unregister = registerLocalPlaybackIpcHandlers(host);
  try {
    await new Promise<void>((resolve) => window.webContents.once("did-finish-load", () => resolve()));
    await host.open("media_123e4567-e89b-42d3-a456-426614174000");
    await waitFor("overlay controls", async () => {
      const overlay = BrowserWindow.getAllWindows().find((candidate) => candidate !== window);
      return !!overlay && await overlay.webContents.executeJavaScript("document.querySelector('#player-toggle-button')?.textContent === '暂停'");
    });
    const overlay = BrowserWindow.getAllWindows().find((candidate) => candidate !== window)!;
    const read = (expression: string) => overlay.webContents.executeJavaScript(expression);
    assert.equal(await read("document.querySelector('#player-next-button').hidden"), true, "no next episode hides the entire button");
    assert.equal(await read("document.querySelector('#player-toggle-button').getAttribute('aria-label')"), "暂停");
    assert.equal(await read("!!document.querySelector('#player-toggle-button svg') && !!document.querySelector('#player-close-button svg')"), true);
    assert.match(await read("document.querySelector('#player-close-button').textContent"), /返回详情/, "the overlay close control names the detail origin");
    await read("document.querySelector('#player-settings-button').click()");
    await waitFor("overlay settings panel", () => read("document.querySelector('#player-settings')?.hidden === false"));
    const overlaySettings = await read(`(() => {
      const panel = document.querySelector('#player-settings');
      const box = panel?.getBoundingClientRect();
      const triggers = ['player-speed-trigger', 'player-audio-trigger', 'player-subtitle-trigger'].map((id) => {
        const trigger = document.getElementById(id);
        return { id, haspopup: trigger?.getAttribute('aria-haspopup') || '', expanded: trigger?.getAttribute('aria-expanded') || '' };
      });
      return {
        groups: [...document.querySelectorAll('#player-settings .player-setting-group h3')].map((heading) => heading.textContent),
        nativeSelects: document.querySelectorAll('select').length,
        panelHaspops: panel?.querySelectorAll('[aria-haspopup="listbox"]').length ?? 0,
        chipSets: [...(panel?.querySelectorAll('.player-chip-set') ?? [])].map((set) => ({
          label: set.getAttribute('aria-label') || '',
          chips: [...set.querySelectorAll('.player-chip')].map((chip) => ({ text: chip.textContent || '', pressed: chip.getAttribute('aria-pressed') })),
        })),
        triggers,
        bodySelect: getComputedStyle(document.body).userSelect,
        fontFamily: getComputedStyle(document.body).fontFamily,
        focusedId: document.activeElement instanceof HTMLElement ? document.activeElement.id : '',
        expanded: document.querySelector('#player-settings-button')?.getAttribute('aria-expanded'),
        panelRect: box ? { left: box.left, right: box.right, top: box.top, bottom: box.bottom } : null,
        viewport: { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight },
      };
    })()`);
    assert.deepEqual(overlaySettings.groups, ["播放速度", "音轨", "字幕", "外挂字幕"], "the overlay mirrors the grouped settings panel");
    assert.equal(overlaySettings.nativeSelects, 0, "the overlay settings panel has no native select");
    assert.equal(overlaySettings.panelHaspops, 0, "the space-constrained overlay panel uses inline chips, not clipped popovers");
    assert.deepEqual(overlaySettings.chipSets.map((set: { label: string }) => set.label), ["播放速度", "音轨", "字幕"], "the overlay exposes the three inline choice groups");
    assert.equal(overlaySettings.chipSets[0].chips.length, 8, "the overlay speed chips mirror every rate");
    assert.equal(overlaySettings.expanded, "true");
    assert.equal(overlaySettings.bodySelect, "none", "the overlay also disables text selection");
    assert.match(String(overlaySettings.fontFamily), /^Nunito,/, "the overlay uses the same app font stack");
    assert.ok(overlaySettings.panelRect!.left >= 0 && overlaySettings.panelRect!.right <= overlaySettings.viewport.width + 1 && overlaySettings.panelRect!.top >= 0 && overlaySettings.panelRect!.bottom <= overlaySettings.viewport.height + 1, `the overlay settings panel stays inside its window: ${JSON.stringify(overlaySettings.panelRect)}`);
    assert.deepEqual(overlaySettings.triggers.map((trigger: { id: string }) => trigger.id), ["player-speed-trigger", "player-audio-trigger", "player-subtitle-trigger"], "the control bar exposes the shared app listboxes");
    assert.equal(overlaySettings.triggers.every((trigger: { haspopup: string }) => trigger.haspopup === "listbox"), true, "each control-bar trigger reports a listbox popup");

    await read(`(() => {
      const chip = [...document.querySelectorAll('#player-speed-chips .player-chip')].find((candidate) => candidate.textContent === '1.25×');
      if (chip instanceof HTMLElement) chip.click();
    })()`);
    const overlayChip = await waitForValue(
      "overlay inline chip state",
      () => read(`(() => {
        const chip = [...document.querySelectorAll('#player-speed-chips .player-chip')].find((candidate) => candidate.textContent === '1.25×');
        return {
          pressed: chip?.getAttribute('aria-pressed') ?? '',
          value: document.querySelector('#player-speed-value')?.textContent || '',
        };
      })()`),
      (value: { pressed: string; value: string }) => value.pressed === "true" && value.value === "1.25×",
    );
    assert.equal(overlayChip.pressed, "true", "overlay inline chips toggle their pressed state");
    assert.equal(overlayChip.value, "1.25×", "overlay inline chips update the shared trigger value");
    await read("document.querySelector('#player-settings-close').click()");
    await waitFor("overlay settings closed", () => read("document.querySelector('#player-settings')?.hidden === true"));
    await read("document.querySelector('#player-settings-button').click()");
    await waitFor("overlay settings reopened for Escape", () => read("document.querySelector('#player-settings')?.hidden === false"));
    await read("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' }))");
    await waitFor("overlay settings closed by Escape", () => read("document.querySelector('#player-settings')?.hidden === true"));
    assert.equal(await read("document.activeElement?.id"), "player-settings-button", "Escape in the overlay returns focus to the settings button");

    const openOverlayMenu = async (kind: string) => {
      await read(`document.querySelector('#player-${kind}-trigger').click()`);
      await waitFor(`overlay ${kind} menu`, () => read(`document.querySelector('#player-${kind}-options')?.hidden === false`));
      await waitFor(`overlay ${kind} menu focus`, async () => (await read("document.activeElement?.getAttribute('role') || ''")) === "option");
      return read(`(() => ({
        count: document.querySelectorAll('#player-${kind}-options [role="option"]').length,
        expanded: document.querySelector('#player-${kind}-trigger')?.getAttribute('aria-expanded'),
        focusedRole: document.activeElement?.getAttribute('role') || '',
        focusedId: document.activeElement instanceof HTMLElement ? document.activeElement.id : '',
        options: [...document.querySelectorAll('#player-${kind}-options [role="option"]')].map((option) => option.textContent || ''),
      }))()`);
    };
    const overlaySpeed = await openOverlayMenu("speed");
    assert.equal(overlaySpeed.count, 8, "the overlay mirrors every speed option");
    assert.equal(overlaySpeed.expanded, "true");
    assert.equal(overlaySpeed.focusedRole, "option", "opening the mirrored menu focuses its selected option");
    const overlayPlacement = await read(`(() => {
      const popover = document.querySelector('#player-speed-options');
      const trigger = document.querySelector('#player-speed-trigger');
      const menu = popover?.getBoundingClientRect();
      const button = trigger?.getBoundingClientRect();
      return {
        menu: menu ? { left: menu.left, right: menu.right, top: menu.top, bottom: menu.bottom } : null,
        trigger: button ? { left: button.left, right: button.right, top: button.top, bottom: button.bottom } : null,
        viewport: { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight },
      };
    })()`);
    assert.ok(overlayPlacement.menu && overlayPlacement.trigger, "the control-bar menu and trigger have layout boxes");
    assert.ok(overlayPlacement.menu!.bottom <= overlayPlacement.trigger!.top, "the control-bar menu opens upward");
    assert.ok(overlayPlacement.menu!.top >= 0 && overlayPlacement.menu!.left >= 0 && overlayPlacement.menu!.right <= overlayPlacement.viewport.width + 1 && overlayPlacement.menu!.bottom <= overlayPlacement.viewport.height + 1, `the control-bar menu is not clipped: ${JSON.stringify(overlayPlacement)}`);
    await read("document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))");
    await waitFor("overlay speed menu keyboard focus", async () => {
      const id = await read("document.activeElement instanceof HTMLElement ? document.activeElement.id : ''");
      return /^player-speed-option-/.test(String(id)) && id !== overlaySpeed.focusedId;
    });
    await read("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' }))");
    await waitFor("overlay speed menu closed", () => read("document.querySelector('#player-speed-options')?.hidden === true"));
    assert.equal(await read("document.activeElement?.id"), "player-speed-trigger", "Escape in the overlay returns focus to the menu trigger");
    const overlayAudio = await openOverlayMenu("audio");
    assert.ok(overlayAudio.options.includes("自动"), "the overlay audio menu starts with the automatic choice");
    await read("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' }))");
    await waitFor("overlay audio menu closed", () => read("document.querySelector('#player-audio-options')?.hidden === true"));
    const overlaySubtitle = await openOverlayMenu("subtitle");
    assert.ok(overlaySubtitle.options.includes("关闭"), "the overlay subtitle menu includes the off choice");
    await read("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' }))");
    await waitFor("overlay subtitle menu closed", () => read("document.querySelector('#player-subtitle-options')?.hidden === true"));
    await read("document.activeElement?.blur()");

    const overlayFeel = await read(`(() => {
      const target = document.querySelector('#player-current-title');
      const event = new Event('contextmenu', { bubbles: true, cancelable: true });
      target?.dispatchEvent(event);
      return {
        contextPrevented: event.defaultPrevented,
        dragPrevented: (() => { const drag = new Event('dragstart', { bubbles: true, cancelable: true }); target?.dispatchEvent(drag); return drag.defaultPrevented; })(),
      };
    })()`);
    assert.equal(overlayFeel.contextPrevented, true, "the overlay suppresses the browser context menu");
    assert.equal(overlayFeel.dragPrevented, true, "the overlay suppresses native dragging");

    await read("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', ctrlKey: true }))");
    await delay(300);
    assert.equal(window.isFullScreen(), false, "Ctrl+F does not trigger the player shortcut");
    await read("document.querySelector('#player-fullscreen-button').click()");
    await waitFor("full screen", async () => window.isFullScreen());
    await waitFor("idle controls hidden", () => read("document.body.classList.contains('overlay-hidden')"));
    await read("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', code: 'KeyX' }))");
    assert.equal(await read("document.body.classList.contains('overlay-hidden')"), false, "keyboard activity reveals controls");
    await waitFor("idle controls hidden again", () => read("document.body.classList.contains('overlay-hidden')"));
    await read("window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientY: 100 }))");
    assert.equal(await read("document.body.classList.contains('overlay-hidden')"), false, "mouse activity reveals controls");
    await read("document.querySelector('#player-toggle-button').click()");
    await waitFor("pause", () => read("document.querySelector('#player-toggle-button').textContent === '播放'"));
    await delay(3300);
    assert.equal(await read("document.body.classList.contains('overlay-hidden')"), false, "pause keeps controls visible");
    await read("document.querySelector('#player-toggle-button').click()");
    await waitFor("playing", () => read("document.querySelector('#player-toggle-button').textContent === '暂停'"));
    await read("document.querySelector('#player-settings-button').click()");
    await delay(3300);
    assert.equal(await read("document.body.classList.contains('overlay-hidden')"), false, "open settings keep controls visible");
    await read("document.querySelector('#player-settings-close').click(); document.querySelector('#player-seek').focus()");
    await delay(3300);
    assert.equal(await read("document.body.classList.contains('overlay-hidden')"), false, "focused controls remain visible");
    await read("document.activeElement.blur(); document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))");
    await delay(3300);
    assert.equal(await read("document.body.classList.contains('overlay-hidden')"), false, "dragging keeps controls visible");
    await read("window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))");
    await host.handle({ type: "close" });
    await waitFor("overlay closed", async () => !overlay.isVisible());
    await delay(3300);
    assert.equal(await read("document.body.classList.contains('overlay-hidden')"), false, "closing cancels the pending hide timer");
    await host.open("media_123e4567-e89b-42d3-a456-426614174001");
    await waitFor("overlay reopened for another media item", async () => overlay.isVisible());
    await waitFor("new media controls", () => read("document.querySelector('#player-toggle-button').textContent === '暂停' && !document.body.classList.contains('overlay-hidden')"));
    window.setSize(900, 640);
    await waitFor("overlay 900x640 layout", async () => (await read("document.documentElement.clientWidth")) <= 905);
    const overlayCompact = await read(`(() => {
      const triggers = [...document.querySelectorAll('.player-quick-trigger')];
      const actions = document.querySelector('.player-actions');
      triggers[2]?.click();
      const menu = document.querySelector('#player-speed-options')?.getBoundingClientRect();
      const viewport = { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight };
      const result = {
        viewport,
        overflowX: actions ? actions.scrollWidth - actions.clientWidth : 0,
        triggers: triggers.map((trigger) => { const box = trigger.getBoundingClientRect(); return { left: box.left, right: box.right, top: box.top, bottom: box.bottom }; }),
        menu: menu ? { left: menu.left, right: menu.right, top: menu.top, bottom: menu.bottom } : null,
      };
      document.querySelector('#player-speed-options')?.setAttribute('hidden', '');
      return result;
    })()`);
    assert.ok(overlayCompact.triggers.length === 3, "all three control-bar listboxes stay mounted at 900x640");
    assert.ok(overlayCompact.triggers.every((box: { left: number; right: number }) => box.left >= 0 && box.right <= overlayCompact.viewport.width + 1), "control-bar listbox triggers stay inside 900x640");
    assert.ok(overlayCompact.overflowX <= 1, "the 900x640 control bar does not overflow horizontally");
    assert.ok(overlayCompact.menu && overlayCompact.menu.left >= 0 && overlayCompact.menu.right <= overlayCompact.viewport.width + 1 && overlayCompact.menu.top >= 0 && overlayCompact.menu.bottom <= overlayCompact.viewport.height + 1, `the 900x640 control-bar menu is not clipped: ${JSON.stringify(overlayCompact.menu)}`);
    await read("document.querySelector('#player-settings-button').click()");
    await waitFor("overlay compact settings panel", () => read("document.querySelector('#player-settings')?.hidden === false"));
    const overlayCompactPanel = await read(`(() => {
      const panel = document.querySelector('#player-settings');
      const box = panel?.getBoundingClientRect();
      return {
        rect: box ? { left: box.left, right: box.right, top: box.top, bottom: box.bottom } : null,
        viewport: { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight },
        chipSets: panel?.querySelectorAll('.player-chip-set').length ?? 0,
        panelHaspops: panel?.querySelectorAll('[aria-haspopup="listbox"]').length ?? 0,
        scrollable: panel ? panel.scrollHeight >= panel.clientHeight : false,
      };
    })()`);
    assert.ok(overlayCompactPanel.rect && overlayCompactPanel.rect.left >= 0 && overlayCompactPanel.rect.right <= overlayCompactPanel.viewport.width + 1 && overlayCompactPanel.rect.top >= 0 && overlayCompactPanel.rect.bottom <= overlayCompactPanel.viewport.height + 1, `the 900x640 settings panel is not clipped: ${JSON.stringify(overlayCompactPanel.rect)}`);
    assert.equal(overlayCompactPanel.chipSets, 3, "the 900x640 settings panel keeps all three inline chip groups");
    assert.equal(overlayCompactPanel.panelHaspops, 0, "the 900x640 settings panel never clips a popover");
    assert.equal(overlayCompactPanel.scrollable, true, "the compact settings panel scrolls its remaining groups instead of clipping them");
    await read("document.querySelector('#player-settings-close').click()");
    await waitFor("overlay compact settings closed", () => read("document.querySelector('#player-settings')?.hidden === true"));
    await read("document.activeElement?.blur()");
    window.setSize(1040, 720);
    await waitFor("overlay default size restored", async () => (await read("document.documentElement.clientWidth")) > 1000);
    await read("document.activeElement?.blur()");

    console.log("PASS: player overlay state, commands, idle and visibility lifecycle (synthetic DOM events)");
  } finally {
    unregister(); await host.close(); if (!window.isDestroyed()) window.destroy(); app.quit();
  }
}

void run().catch((error) => { console.error(error); app.exit(1); });
