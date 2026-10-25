import { useEffect, useState } from 'react';
import { MAX_FONT_SIZE, MIN_FONT_SIZE, PANEL_COLORS, readableTextOn, TEXT_COLORS, type Config } from '../config';
import { checkBinding, comboFromEvent, displayAccelerator, HOTKEY_DEFS, resolveHotkeys, type HotkeyId } from '../lib/hotkeys';
import { listMicrophones } from '../lib/speech/recorder';
import type { ModelStatus } from '../lib/speech/engine';
import { Icon } from './Icon';

interface SettingsProps {
  config: Config;
  setConfig: (updates: Partial<Config>) => void;
  modelStatus: ModelStatus;
  onRecordingShortcut: (recording: boolean) => void;
  onClose: () => void;
}

/** Settings, applied as they change */
function Settings({ config, setConfig, modelStatus, onRecordingShortcut, onClose }: SettingsProps) {
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    listMicrophones().then(setMics).catch(() => {});
  }, []);

  const modelNote =
    modelStatus.state === 'loading' ? `Loading the speech model… ${Math.round(modelStatus.progress)}%`
      : modelStatus.state === 'failed' ? "The speech model couldn't load. Use the AI service instead, or restart toyol."
        : 'Whisper small, on this PC: nothing you say leaves it.';

  return (
    <div className="settings">
      <div className="settings-header">
        <h2>Settings</h2>
        <button className="icon-button" onClick={onClose} title="Close (Esc)" aria-label="Close settings">
          <Icon name="close" />
        </button>
      </div>

      <div className="settings-body">
        <Section title="AI service" note="Any OpenAI-compatible Responses API: OpenAI, Azure AI Foundry, … Questions and screenshots go to it.">
          <Field label="Endpoint">
            <input value={config.aiEndpoint} placeholder="https://api.openai.com/v1" spellCheck={false} onChange={(e) => setConfig({ aiEndpoint: e.target.value.trim() })} />
          </Field>
          <Field label="Model">
            <input value={config.aiModel} placeholder="Model or deployment name" spellCheck={false} onChange={(e) => setConfig({ aiModel: e.target.value.trim() })} />
          </Field>
          <Field label="API key">
            <div className="field-inline">
              <input type={showKey ? 'text' : 'password'} value={config.aiApiKey} spellCheck={false} onChange={(e) => setConfig({ aiApiKey: e.target.value.trim() })} />
              <button className="text-button" onClick={() => setShowKey((s) => !s)}>{showKey ? 'Hide' : 'Show'}</button>
            </div>
          </Field>
        </Section>

        <Section title="Voice">
          <Field label="Transcription">
            <div className="segmented">
              <button className={config.speechEngine === 'local' ? 'on' : ''} onClick={() => setConfig({ speechEngine: 'local' })}>On this PC</button>
              <button className={config.speechEngine === 'cloud' ? 'on' : ''} onClick={() => setConfig({ speechEngine: 'cloud' })}>AI service</button>
            </div>
            <p className="hint">
              {config.speechEngine === 'local' ? modelNote : 'Usually the most accurate, with strong accents too. Your recording goes to the AI service.'}
            </p>
          </Field>
          {config.speechEngine === 'cloud' && (
            <Field label="Transcription model">
              <input value={config.cloudSpeechModel} placeholder="gpt-4o-transcribe" spellCheck={false} onChange={(e) => setConfig({ cloudSpeechModel: e.target.value.trim() })} />
            </Field>
          )}
          <Field label="Microphone">
            <select value={config.micId} onChange={(e) => setConfig({ micId: e.target.value })}>
              <option value="">System default</option>
              {mics.map((m, i) => <option key={m.deviceId} value={m.deviceId}>{m.label || `Microphone ${i + 1}`}</option>)}
            </select>
          </Field>
          <Field label="Words to recognize">
            <textarea rows={3} value={config.vocabulary} spellCheck={false} onChange={(e) => setConfig({ vocabulary: e.target.value })} />
            <p className="hint">Names and jargon, comma-separated. Spelled this way when heard, and offered as you type.</p>
          </Field>
          <Toggle label="Send right away" note="Ask as soon as you stop talking or pick a region, instead of waiting for Enter." checked={config.autoSend} onChange={(autoSend) => setConfig({ autoSend })} />
        </Section>

        <Section title="Appearance">
          <Field label={`Background opacity · ${Math.round(config.opacity * 100)}%`}>
            <input type="range" min="0.2" max="1" step="0.05" value={config.opacity} onChange={(e) => setConfig({ opacity: parseFloat(e.target.value) })} />
          </Field>
          <Field label="Text size">
            <div className="stepper">
              <button className="icon-button" onClick={() => setConfig({ fontSize: Math.max(MIN_FONT_SIZE, config.fontSize - 1) })} aria-label="Smaller"><Icon name="minus" size={13} /></button>
              <span>{config.fontSize}px</span>
              <button className="icon-button" onClick={() => setConfig({ fontSize: Math.min(MAX_FONT_SIZE, config.fontSize + 1) })} aria-label="Larger"><Icon name="plus" size={13} /></button>
            </div>
          </Field>
          <Field label="Panel color">
            <Swatches
              colors={PANEL_COLORS.map((c) => c.bg)}
              value={config.bgColor}
              onPick={(bgColor) => setConfig({ bgColor, textColor: PANEL_COLORS.find((c) => c.bg === bgColor)?.text ?? readableTextOn(bgColor) })}
            />
          </Field>
          <Field label="Text color">
            <Swatches colors={TEXT_COLORS} value={config.textColor} onPick={(textColor) => setConfig({ textColor })} />
          </Field>
          <Toggle label="Hide from screen capture" note="Left out of screen shares, recordings and screenshots." checked={config.hideFromCapture} onChange={(hideFromCapture) => setConfig({ hideFromCapture })} />
        </Section>

        <Section title="Shortcuts" note="Click one, then press the new keys. The Ctrl+Alt+Shift ones work anywhere, even locked.">
          <ShortcutList config={config} setConfig={setConfig} onRecording={onRecordingShortcut} />
        </Section>
      </div>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="settings-section">
      <h3>{title}</h3>
      {note && <p className="hint">{note}</p>}
      <div className="card">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

function Toggle({ label, note, checked, onChange }: { label: string; note: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="toggle">
      <span>
        <span className="field-label">{label}</span>
        <span className="hint">{note}</span>
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function Swatches({ colors, value, onPick }: { colors: string[]; value: string; onPick: (color: string) => void }) {
  const custom = !colors.some((c) => c.toLowerCase() === value.toLowerCase());
  return (
    <div className="swatches">
      {colors.map((c) => (
        <button
          key={c}
          className={`swatch${c.toLowerCase() === value.toLowerCase() ? ' on' : ''}`}
          style={{ background: c }}
          onClick={(e) => {
            e.preventDefault();
            onPick(c);
          }}
          aria-label={c}
          title={c}
        />
      ))}
      <span className={`swatch custom${custom ? ' on' : ''}`} title="Custom color" style={custom ? { background: value } : undefined}>
        <input type="color" value={value} onChange={(e) => onPick(e.target.value.toUpperCase())} aria-label="Custom color" />
      </span>
    </div>
  );
}

function ShortcutList({ config, setConfig, onRecording }: { config: Config; setConfig: (u: Partial<Config>) => void; onRecording: (on: boolean) => void }) {
  const [recording, setRecording] = useState<HotkeyId | null>(null);
  const [error, setError] = useState<{ id: HotkeyId; text: string } | null>(null);
  const hotkeys = resolveHotkeys(config.hotkeys);

  useEffect(() => {
    onRecording(recording !== null);
    if (!recording) return;
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setRecording(null);
        return;
      }
      const combo = comboFromEvent(e);
      if (!combo.code) return; // only modifiers so far
      const check = checkBinding(recording, combo, hotkeys);
      if (!check.ok) {
        setError({ id: recording, text: check.error });
        return;
      }
      const custom = { ...config.hotkeys, [recording]: check.binding };
      if (check.binding === HOTKEY_DEFS.find((d) => d.id === recording)?.default) delete custom[recording];
      setConfig({ hotkeys: custom });
      setError(null);
      setRecording(null);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [recording, config.hotkeys, hotkeys, setConfig, onRecording]);

  useEffect(() => () => onRecording(false), [onRecording]);

  return (
    <>
      <ul className="shortcuts">
        {HOTKEY_DEFS.map((def) => (
          <li key={def.id}>
            <span className="shortcut-action">
              {def.action}
              {error?.id === def.id && <span className="shortcut-error">{error.text}</span>}
            </span>
            <button
              className={`kbd${recording === def.id ? ' recording' : ''}`}
              onClick={(e) => {
                e.preventDefault();
                setError(null);
                setRecording(recording === def.id ? null : def.id);
              }}
            >
              {recording === def.id ? 'Press keys…' : displayAccelerator(hotkeys[def.id])}
            </button>
          </li>
        ))}
        <li>
          <span className="shortcut-action">Unlock (while locked)</span>
          <span className="kbd fixed">Esc</span>
        </li>
      </ul>
      {Object.keys(config.hotkeys).length > 0 && (
        <button className="text-button" onClick={() => setConfig({ hotkeys: {} })}>Reset all shortcuts</button>
      )}
    </>
  );
}

export default Settings;
