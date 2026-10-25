// Keyboard shortcuts: what each does, its default, and the user's own
// (Settings › Shortcuts). Kept as accelerators like "Ctrl+Alt+Shift+KeyH":
// modifiers in that order, then the key's KeyboardEvent.code, which is what the
// global-shortcut plugin parses and what a keydown is turned into to compare.
//
// Shortcuts that work anywhere use Ctrl+Alt+Shift by default (as ScreenPrompt
// does): Ctrl+Shift+letter is where Teams keeps mute, camera and hang up, and
// Alt+letter is Zoom's, so these don't take keys from a call.

export type HotkeyId =
  | 'toggleVisibility'
  | 'toggleLock'
  | 'ask'
  | 'voice'
  | 'snip'
  | 'newChat'
  | 'cycleOpacity'
  | 'quit'
  | 'settings'
  | 'fontUp'
  | 'fontDown'
  | 'fontReset';

export interface HotkeyDef {
  id: HotkeyId;
  action: string;
  // global: works anywhere, even locked or with another app in front.
  // focused: only while the panel has focus.
  scope: 'global' | 'focused';
  default: string;
}

export type Hotkeys = Record<HotkeyId, string>;

const ALL = 'Ctrl+Alt+Shift';

export const HOTKEY_DEFS: HotkeyDef[] = [
  { id: 'ask', action: 'Type a question (unlocks until you click away)', scope: 'global', default: `${ALL}+KeyA` },
  { id: 'voice', action: 'Speak a question: tap to start and stop, or hold while talking', scope: 'global', default: `${ALL}+Space` },
  { id: 'snip', action: 'Screenshot a region: click two corners', scope: 'global', default: `${ALL}+KeyS` },
  { id: 'toggleLock', action: 'Lock / unlock (locked, clicks go through)', scope: 'global', default: `${ALL}+KeyL` },
  { id: 'toggleVisibility', action: 'Show / hide', scope: 'global', default: `${ALL}+KeyH` },
  { id: 'newChat', action: 'New conversation', scope: 'global', default: `${ALL}+KeyN` },
  { id: 'cycleOpacity', action: 'Cycle opacity', scope: 'global', default: `${ALL}+KeyO` },
  { id: 'quit', action: 'Quit', scope: 'global', default: `${ALL}+KeyQ` },
  { id: 'settings', action: 'Settings', scope: 'focused', default: 'Ctrl+Comma' },
  { id: 'fontUp', action: 'Larger text', scope: 'focused', default: 'Ctrl+Equal' },
  { id: 'fontDown', action: 'Smaller text', scope: 'focused', default: 'Ctrl+Minus' },
  { id: 'fontReset', action: 'Reset text size', scope: 'focused', default: 'Ctrl+Digit0' },
];

const DEF = Object.fromEntries(HOTKEY_DEFS.map((d) => [d.id, d])) as Record<HotkeyId, HotkeyDef>;

/** A key combo: modifiers, and the key (a KeyboardEvent.code; null while only modifiers are down) */
export interface Combo {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  code: string | null;
}

const MODIFIER_CODES = new Set([
  'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'ShiftLeft', 'ShiftRight',
  'MetaLeft', 'MetaRight', 'OSLeft', 'OSRight', 'CapsLock', 'NumLock', 'ScrollLock',
]);

export function parseAccelerator(accelerator: string): Combo {
  const combo: Combo = { ctrl: false, alt: false, shift: false, code: null };
  for (const part of accelerator.split('+').filter(Boolean)) {
    const name = part.toLowerCase();
    if (name === 'ctrl' || name === 'control') combo.ctrl = true;
    else if (name === 'alt') combo.alt = true;
    else if (name === 'shift') combo.shift = true;
    else combo.code = part;
  }
  return combo;
}

export function formatAccelerator(combo: Combo): string {
  const parts: string[] = [];
  if (combo.ctrl) parts.push('Ctrl');
  if (combo.alt) parts.push('Alt');
  if (combo.shift) parts.push('Shift');
  if (combo.code) parts.push(combo.code);
  return parts.join('+');
}

/**
 * The combo a keydown is. Letters go by the letter typed rather than the key's
 * position, so on a QWERTZ or AZERTY keyboard "Z" is the key marked Z, as with
 * global shortcuts (Windows hotkeys).
 */
export function comboFromEvent(e: Pick<KeyboardEvent, 'ctrlKey' | 'altKey' | 'shiftKey' | 'code' | 'key'>): Combo {
  let code: string | null = MODIFIER_CODES.has(e.code) || !e.code ? null : e.code;
  if (code && /^[a-z]$/i.test(e.key)) code = `Key${e.key.toUpperCase()}`;
  return { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, code };
}

const KEY_NAMES: Record<string, string> = {
  Comma: ',', Period: '.', Minus: '-', Equal: '=', Slash: '/', Backslash: '\\',
  BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Backquote: '`',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Escape: 'Esc',
};

function keyName(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return `Num${code.slice(6)}`;
  return KEY_NAMES[code] ?? code;
}

/** As people write it: "Ctrl+Alt+Shift+KeyH" -> "Ctrl+Alt+Shift+H" */
export function displayAccelerator(accelerator: string): string {
  const combo = parseAccelerator(accelerator);
  return formatAccelerator({ ...combo, code: combo.code && keyName(combo.code) });
}

/** The saved custom shortcuts, with defaults for the rest (and for any no longer valid) */
export function resolveHotkeys(custom: Partial<Record<string, string>> | undefined): Hotkeys {
  const out = {} as Hotkeys;
  for (const def of HOTKEY_DEFS) {
    const saved = custom?.[def.id];
    out[def.id] = typeof saved === 'string' && saved && !invalidReason(def, parseAccelerator(saved)) ? saved : def.default;
  }
  return out;
}

// Kept for typing (select all, copy, paste, cut, undo, redo)
const TYPING = new Set(['KeyA', 'KeyC', 'KeyV', 'KeyX', 'KeyY', 'KeyZ']);

function invalidReason(def: HotkeyDef, combo: Combo): string | null {
  const code = combo.code;
  if (!code) return 'Press a key along with the modifiers';
  if (code === 'Escape' || code === 'Tab' || code === 'Enter') return `${keyName(code)} is kept for the panel`;
  if (!combo.ctrl && !combo.alt) {
    return def.scope === 'global'
      ? 'Use Ctrl or Alt: on its own it would stop that key working in every app'
      : 'Use Ctrl or Alt';
  }
  if (combo.ctrl && !combo.alt && !combo.shift && TYPING.has(code)) return 'Kept for copy, paste and undo';
  if (combo.alt && !combo.ctrl && !combo.shift && code === 'F4') return 'Alt+F4 closes windows';
  return null;
}

export type BindingCheck = { ok: true; binding: string } | { ok: false; error: string };

/** Whether a combo pressed while recording can become `id`'s shortcut */
export function checkBinding(id: HotkeyId, combo: Combo, hotkeys: Hotkeys): BindingCheck {
  const reason = invalidReason(DEF[id], combo);
  if (reason) return { ok: false, error: reason };
  const binding = formatAccelerator(combo);
  const clash = HOTKEY_DEFS.find((d) => d.id !== id && hotkeys[d.id] === binding);
  if (clash) return { ok: false, error: `Already used for “${clash.action}”` };
  return { ok: true, binding };
}
