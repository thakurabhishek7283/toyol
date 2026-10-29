import { useEffect, useRef, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { MAX_FONT_SIZE, MIN_FONT_SIZE, PANEL_COLORS, readableTextOn, TEXT_COLORS, type AutoScroll, type Config } from '../config';
import type { AnswerMode, Tone } from '../lib/ai';
import { checkBinding, comboFromEvent, displayAccelerator, HOTKEY_DEFS, resolveHotkeys, type HotkeyId } from '../lib/hotkeys';
import { listMicrophones } from '../lib/speech/recorder';
import type { ModelStatus } from '../lib/speech/engine';
import type { LicenseStatus } from '../hooks/useLicense';
import type { useUpdater } from '../hooks/useUpdater';
import { Icon } from './Icon';

const AUTO_SCROLL_OPTIONS: [AutoScroll, string][] = [['off', 'Off'], ['slow', 'Slow'], ['medium', 'Medium'], ['fast', 'Fast']];

// Who answers, and what that's like
const ANSWER_MODE_OPTIONS: [AnswerMode, string, string][] = [
  ['assistant', 'Assistant', 'Explains the answer to you.'],
  ['interview', 'Candidate', 'Mock interview: answers your question as the candidate would, quick for simple questions and as a case-study walk-through for open ones.'],
];

// Each tone, and what it sounds like
const TONE_OPTIONS: [Tone, string, string][] = [
  ['default', 'Default', 'Direct and to the point.'],
  ['conversational', 'Conversational', 'Natural, like a colleague talking it through: easy to say out loud.'],
  ['professional', 'Professional', 'Polished, precise and formal.'],
  ['simple', 'Simple', 'Everyday words, jargon explained, analogies.'],
  ['technical', 'Technical', 'Exact terms and specifics, for an expert.'],
  ['custom', 'Your own', 'Describe it below.'],
];

interface SettingsProps {
  config: Config;
  setConfig: (updates: Partial<Config>) => void;
  modelStatus: ModelStatus;
  updater: ReturnType<typeof useUpdater>;
  license: LicenseStatus | null;
  onRecordingShortcut: (recording: boolean) => void;
  onClose: () => void;
}

/** Settings, applied as they change */
function Settings({ config, setConfig, modelStatus, updater, license, onRecordingShortcut, onClose }: SettingsProps) {
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [showKey, setShowKey] = useState(false);
  const [version, setVersion] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

  // Opened from the keyboard: start there, so Tab goes through the settings
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  useEffect(() => {
    listMicrophones().then(setMics).catch(() => {});
  }, []);

  const modelNote =
    modelStatus.state === 'downloading' ? `Downloading the speech model (820 MB, just this once): ${Math.floor((modelStatus.progress ?? 0) * 100)}%…`
      : modelStatus.state === 'loading' ? 'Loading the speech model…'
        : modelStatus.state === 'failed' ? `The speech model couldn't load${modelStatus.error ? ` (${modelStatus.error})` : ''}. It tries again when you next talk; or use the AI service.`
          : `Whisper medium, on this PC${modelStatus.device ? ` (${modelStatus.device})` : ''}: transcribed as you talk, and nothing you say leaves it.`;

  const updateNote = {
    idle: '',
    checking: 'Checking…',
    current: 'This is the latest version.',
    available: `Version ${updater.version} is out.`,
    installing: 'Installing: toyol closes for a moment and comes back updated…',
    failed: `Couldn't update (${updater.error}).`,
  }[updater.phase];

  return (
    <div className="settings" ref={rootRef} tabIndex={-1} role="region" aria-label="Settings">
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

        <Section title="Answers" note="Who answers, and how it's worded. The layout stays the same; it applies from the next question.">
          <Field label="Answer as">
            <div className="segmented">
              {ANSWER_MODE_OPTIONS.map(([value, label]) => (
                <button key={value} className={config.answerMode === value ? 'on' : ''} aria-pressed={config.answerMode === value} onClick={() => setConfig({ answerMode: value })}>{label}</button>
              ))}
            </div>
            <p className="hint">{ANSWER_MODE_OPTIONS.find(([value]) => value === config.answerMode)?.[2]}</p>
          </Field>
          {config.answerMode === 'interview' && (
            <Field label="Your background">
              <textarea
                rows={4}
                value={config.background}
                placeholder="e.g. 4 years backend at a fintech: Java, Spring Boot, Kafka, PostgreSQL. Built the payment reconciliation service; cut nightly batch time from 3 h to 40 min. Interviewing for senior backend roles."
                onChange={(e) => setConfig({ background: e.target.value })}
              />
              <p className="hint">The only experience answers may claim as yours. Left empty, they speak from practice and use [placeholders] for your own stories, rather than making any up.</p>
            </Field>
          )}
          <Field label="Tone">
            <select value={config.tone} onChange={(e) => setConfig({ tone: e.target.value as Tone })}>
              {TONE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <p className="hint">{TONE_OPTIONS.find(([value]) => value === config.tone)?.[2]}</p>
          </Field>
          {config.tone === 'custom' && (
            <Field label="Your tone">
              <textarea
                rows={2}
                value={config.customTone}
                placeholder="e.g. Friendly and upbeat, British spelling, like a senior engineer mentoring a junior"
                onChange={(e) => setConfig({ customTone: e.target.value })}
              />
            </Field>
          )}
        </Section>

        <Section title="Voice">
          <Field label="Transcription">
            <div className="segmented">
              <button className={config.speechEngine === 'local' ? 'on' : ''} aria-pressed={config.speechEngine === 'local'} onClick={() => setConfig({ speechEngine: 'local' })}>On this PC</button>
              <button className={config.speechEngine === 'cloud' ? 'on' : ''} aria-pressed={config.speechEngine === 'cloud'} onClick={() => setConfig({ speechEngine: 'cloud' })}>AI service</button>
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
          <Toggle label="Hold to talk" note="Listen only while the voice shortcut or the mic button is held down; let go to send. Off: a tap also starts listening, until the next tap." checked={config.holdToTalk} onChange={(holdToTalk) => setConfig({ holdToTalk })} />
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
          <Field label="Auto-scroll answers">
            <div className="segmented">
              {AUTO_SCROLL_OPTIONS.map(([value, label]) => (
                <button key={value} className={config.autoScroll === value ? 'on' : ''} aria-pressed={config.autoScroll === value} onClick={() => setConfig({ autoScroll: value })}>{label}</button>
              ))}
            </div>
            <p className="hint">A new answer jumps to the top of the panel; a long one waits a moment, then scrolls down slowly as you read. Scrolling yourself stops it until the next answer.</p>
          </Field>
        </Section>

        <Section title="Shortcuts" note="Pick one (click it, or Enter), then press the new keys; Esc keeps the old ones. The Ctrl+Alt+Shift ones work anywhere, even locked.">
          <ShortcutList config={config} setConfig={setConfig} onRecording={onRecordingShortcut} />
        </Section>

        <Section title="License" note="The license key is for this PC only. For another PC, or after reinstalling Windows, send that PC's code for a new key.">
          <div className="field-inline about">
            <span className="field-label">Licensed to {license?.name}</span>
            <span className="hint">
              {license?.expires ? `until ${new Date(license.expires * 1000).toLocaleDateString()}` : 'no end date'}
            </span>
          </div>
          <p className="hint">This PC's code: {license?.machineCode}</p>
        </Section>

        <Section title="About" note="Updates come from the toyol releases on GitHub. A new one shows in the title bar; it installs only when you click it.">
          <div className="field-inline about">
            <span className="field-label">toyol {version}</span>
            {updater.phase === 'available' ? (
              <button className="text-button" onClick={updater.install}>Install {updater.version}</button>
            ) : (
              <button className="text-button" onClick={updater.check} disabled={updater.phase === 'checking' || updater.phase === 'installing'}>
                Check for updates
              </button>
            )}
          </div>
          {updateNote && <p className="hint">{updateNote}</p>}
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
          aria-pressed={c.toLowerCase() === value.toLowerCase()}
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
        <li>
          <span className="shortcut-action">Done moving (meanwhile: arrows move, held to keep going; Shift+arrow to that edge; Ctrl+arrow resizes)</span>
          <span className="kbd fixed">Enter</span>
        </li>
        <li>
          <span className="shortcut-action">Cancel a screenshot (meanwhile: arrows and Enter pick the corners; Ctrl+A takes the whole screen)</span>
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
