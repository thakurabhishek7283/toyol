import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { currentMonitor, getCurrentWindow, LogicalSize, PhysicalPosition, primaryMonitor } from '@tauri-apps/api/window';
import { DEFAULT_CONFIG, MAX_FONT_SIZE, MIN_FONT_SIZE, OPACITY_STEPS } from './config';
import { useConfig } from './hooks/useConfig';
import { useChat } from './hooks/useChat';
import { useHotkeys } from './hooks/useHotkeys';
import { useLicense } from './hooks/useLicense';
import { useMemory } from './hooks/useMemory';
import { isOnAnyMonitor, useMovePanel } from './hooks/useMovePanel';
import { useSnip } from './hooks/useSnip';
import { useUpdater } from './hooks/useUpdater';
import { useVoice } from './hooks/useVoice';
import { parseAnswer } from './lib/answer';
import { conversationTerms } from './lib/autocomplete';
import { displayAccelerator, resolveHotkeys, type Hotkeys } from './lib/hotkeys';
import { getModelStatus, subscribeModelStatus } from './lib/speech/engine';
import { buildPrompt, parseVocabulary } from './lib/speech/transcript';
import type { InputSource } from './lib/ai';
import Activation from './components/Activation';
import TitleBar from './components/TitleBar';
import Conversation from './components/Conversation';
import Composer from './components/Composer';
import Settings from './components/Settings';
import './styles/app.css';

const appWindow = getCurrentWindow();
const NOTE_MS = 4500;
const GEOMETRY_SAVE_DELAY_MS = 400;
const FIRST_RUN_MARGIN = 24; // logical px from the screen's top-right corner
// Windows parks minimized windows here; never save it as a position
const MINIMIZED_COORD = -32000;
const PAGE_SCROLL = 0.85; // of the answers' height, per PageUp / PageDown

function App() {
  const { config, setConfig, loading } = useConfig();
  const { memory, rememberQuestion, rememberTerms } = useMemory();
  const hotkeys = useMemo(() => resolveHotkeys(config.hotkeys), [config.hotkeys]);
  const ai = useMemo(
    () => ({ endpoint: config.aiEndpoint, model: config.aiModel, apiKey: config.aiApiKey, tone: config.tone, customTone: config.customTone }),
    [config.aiEndpoint, config.aiModel, config.aiApiKey, config.tone, config.customTone],
  );
  const { turns, busy, ask, stop, reset } = useChat(ai);
  const modelStatus = useSyncExternalStore(subscribeModelStatus, getModelStatus);
  const updater = useUpdater();
  const license = useLicense();

  const [locked, setLocked] = useState(false);
  const [visible, setVisible] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [recordingShortcut, setRecordingShortcut] = useState(false);
  const [draft, setDraft] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const quickAskRef = useRef(false); // unlocked just to type: lock again on blur
  const voiceTextRef = useRef(''); // what voice input put in the box, to tell typed from spoken
  const restoredRef = useRef(false);
  const conversationRef = useRef<HTMLDivElement>(null);

  const showNote = useCallback((message: string) => setNote(message), []);
  useEffect(() => {
    if (!note) return;
    const timer = window.setTimeout(() => setNote(null), NOTE_MS);
    return () => window.clearTimeout(timer);
  }, [note]);

  // --- window ---------------------------------------------------------------

  // Click-through, and the hooks that go with it (Esc and Ctrl+click on the lock
  // to unlock, Ctrl+wheel to scroll). Doesn't save; callers decide that.
  const applyLock = useCallback(async (on: boolean) => {
    await invoke('set_click_through', { window: appWindow, enabled: on });
    setLocked(on);
    if (on) {
      await invoke('install_mouse_hook', { window: appWindow }).catch((e: unknown) => console.error('Mouse hook failed:', e));
      await invoke('install_keyboard_hook').catch((e: unknown) => console.error('Keyboard hook failed:', e));
    } else {
      await invoke('uninstall_mouse_hook').catch(() => {});
      await invoke('uninstall_keyboard_hook').catch(() => {});
    }
  }, []);

  const toggleLock = useCallback(async () => {
    const next = !locked;
    quickAskRef.current = false;
    await applyLock(next).catch((e: unknown) => console.error('Lock failed:', e));
    setConfig({ locked: next });
    if (next) setShowSettings(false);
  }, [locked, applyLock, setConfig]);

  // Always unlocks: if React and the window ever disagree, a guard here would leave no way back
  const emergencyUnlock = useCallback(async () => {
    quickAskRef.current = false;
    await applyLock(false).catch((e: unknown) => console.error('Unlock failed:', e));
    setConfig({ locked: false });
  }, [applyLock, setConfig]);

  // Moving shows the panel first; reveal comes further down
  const revealRef = useRef<() => Promise<void>>(async () => {});
  const move = useMovePanel(useCallback(() => {
    revealRef.current().catch(() => {});
  }, []));
  const { escapeIsOurs } = move;

  useEffect(() => {
    const unlisten = listen('emergency-unlock', () => {
      // The keyboard hook sees every Esc, the one that ends moving too
      if (!escapeIsOurs()) emergencyUnlock();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [emergencyUnlock, escapeIsOurs]);

  // Windows doesn't run our keyboard hook for keys typed into the panel itself,
  // so Esc while the locked panel has focus arrives here instead
  useEffect(() => {
    if (!locked) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') emergencyUnlock();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [locked, emergencyUnlock]);

  // Unlocked just to type a question: lock again once focus goes back to the other app
  useEffect(() => {
    const unlisten = appWindow.onFocusChanged(async ({ payload: focused }) => {
      if (focused || !quickAskRef.current) return;
      quickAskRef.current = false;
      await applyLock(true).catch((e: unknown) => console.error('Re-lock failed:', e));
      setConfig({ locked: true });
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [applyLock, setConfig]);

  const reveal = useCallback(async () => {
    if (visible) return;
    await appWindow.show();
    setVisible(true);
  }, [visible]);
  useEffect(() => {
    revealRef.current = reveal;
  }, [reveal]);

  const toggleVisibility = useCallback(async () => {
    if (visible) {
      await appWindow.hide();
      setVisible(false);
    } else {
      await appWindow.show();
      await appWindow.setFocus();
      setVisible(true);
      if (!locked) setFocusRequest((n) => n + 1);
    }
  }, [visible, locked]);

  const quit = useCallback(async () => {
    await invoke('uninstall_mouse_hook').catch(() => {});
    await invoke('uninstall_keyboard_hook').catch(() => {});
    await appWindow.close();
  }, []);

  // Restore size, position and lock once, then show. Position is physical px
  // (unambiguous across monitors), size logical (same look at any scaling).
  useEffect(() => {
    if (loading || !license.status || restoredRef.current) return;
    restoredRef.current = true;
    (async () => {
      try {
        await appWindow.setSize(new LogicalSize(config.width, config.height));
        if (config.x !== null && config.y !== null && (await isOnAnyMonitor(config.x + 40, config.y + 10))) {
          await appWindow.setPosition(new PhysicalPosition(config.x, config.y));
        } else {
          // First run (or its monitor is gone): the top-right corner of the screen.
          // A window not shown yet may have no current monitor: then the primary one.
          const monitor = (await currentMonitor()) ?? (await primaryMonitor());
          if (monitor) {
            const { position, size } = monitor.workArea;
            const outer = await appWindow.outerSize();
            const margin = Math.round(FIRST_RUN_MARGIN * monitor.scaleFactor);
            await appWindow.setPosition(new PhysicalPosition(position.x + size.width - outer.width - margin, position.y + margin));
          }
        }
      } catch (error) {
        console.error('Failed to restore the window:', error);
      }
      try {
        await appWindow.show();
      } catch (error) {
        console.error('Failed to show the window:', error);
      }
      // Not before activating: Activation needs clicks
      if (config.locked && license.licensed) await applyLock(true).catch((e: unknown) => console.error('Failed to restore the lock:', e));
    })();
  }, [loading, config, applyLock, license.status, license.licensed]);

  // Save position and size after a move or resize
  useEffect(() => {
    let timer: number | undefined;
    const save = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        try {
          const [pos, size, scale] = await Promise.all([appWindow.outerPosition(), appWindow.innerSize(), appWindow.scaleFactor()]);
          if (pos.x <= MINIMIZED_COORD || pos.y <= MINIMIZED_COORD) return;
          const logical = size.toLogical(scale);
          setConfig({ x: pos.x, y: pos.y, width: Math.round(logical.width), height: Math.round(logical.height) });
        } catch (error) {
          console.error('Failed to save the window position:', error);
        }
      }, GEOMETRY_SAVE_DELAY_MS);
    };
    const moved = appWindow.onMoved(save);
    const resized = appWindow.onResized(save);
    return () => {
      window.clearTimeout(timer);
      moved.then((fn) => fn());
      resized.then((fn) => fn());
    };
  }, [setConfig]);

  useEffect(() => {
    if (loading) return;
    invoke('set_capture_visible', { window: appWindow, visible: !config.hideFromCapture }).catch((e: unknown) => console.error('Capture setting failed:', e));
  }, [loading, config.hideFromCapture]);

  // --- asking ---------------------------------------------------------------

  const send = useCallback((text: string, source: InputSource, withImage: string | null) => {
    if (!text.trim() && !withImage) return;
    if (source === 'typed' && text.trim()) rememberQuestion(text);
    ask(text, withImage ? 'screen' : source, withImage ?? undefined);
    setDraft('');
    setImage(null);
    voiceTextRef.current = '';
  }, [ask, rememberQuestion]);

  const sendDraft = useCallback(() => {
    const spoken = voiceTextRef.current !== '' && draft.includes(voiceTextRef.current);
    send(draft, spoken ? 'voice' : 'typed', image);
  }, [draft, image, send]);

  // Once an answer is in, autocompletion learns the question as understood and the answer's terms
  const learnedRef = useRef(new Set<number>());
  useEffect(() => {
    for (const turn of turns) {
      if (turn.state !== 'done' || learnedRef.current.has(turn.id)) continue;
      learnedRef.current.add(turn.id);
      const parsed = parseAnswer(turn.answer);
      if (parsed.question) rememberQuestion(parsed.question);
      rememberTerms(`${parsed.glance}\n${parsed.details}`);
    }
  }, [turns, rememberQuestion, rememberTerms]);

  // Show the box to type in. While locked this unlocks until focus goes back to the other app.
  const focusInput = useCallback(async () => {
    try {
      setShowSettings(false);
      await reveal();
      if (locked) {
        await applyLock(false);
        quickAskRef.current = true;
      }
      await appWindow.setFocus();
      setFocusRequest((n) => n + 1);
    } catch (error) {
      console.error('Focusing the input failed:', error);
    }
  }, [locked, reveal, applyLock]);

  // --- voice and screenshots ------------------------------------------------

  const lastQuestion = turns.length ? parseAnswer(turns[turns.length - 1].answer).question : '';
  const vocabulary = useMemo(() => parseVocabulary(config.vocabulary), [config.vocabulary]);

  const voice = useVoice({
    options: () => ({
      engine: config.speechEngine,
      // The user's words, then what the conversation is about, steer recognition
      prompt: buildPrompt(vocabulary, lastQuestion),
      ai,
      cloudModel: config.cloudSpeechModel,
    }),
    micId: config.micId,
    holdToTalk: config.holdToTalk,
    preload: !loading && license.licensed && config.speechEngine === 'local',
    onText: (text) => {
      reveal().catch(() => {});
      const combined = draft.trim() ? `${draft.trim()} ${text}` : text;
      if (config.autoSend) {
        send(combined, 'voice', image);
      } else {
        voiceTextRef.current = text;
        setDraft(combined);
        if (!locked) setFocusRequest((n) => n + 1);
      }
    },
    onNote: showNote,
  });

  const snip = useSnip(
    (shot) => {
      reveal().catch(() => {});
      if (config.autoSend) {
        send(draft, 'screen', shot);
      } else {
        setImage(shot);
        if (!locked) setFocusRequest((n) => n + 1);
      }
    },
    showNote,
  );

  // --- shortcuts ------------------------------------------------------------

  const newChat = useCallback(() => {
    reset();
    setDraft('');
    setImage(null);
    if (!locked) setFocusRequest((n) => n + 1);
  }, [reset, locked]);

  const scrollAnswers = useCallback((direction: 1 | -1) => {
    const answers = conversationRef.current;
    answers?.scrollBy({ top: direction * answers.clientHeight * PAGE_SCROLL, behavior: 'smooth' });
  }, []);

  const setFontSize = useCallback((size: number) => {
    setConfig({ fontSize: Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, size)) });
  }, [setConfig]);

  useHotkeys({
    ask: focusInput,
    voiceDown: voice.keyDown,
    voiceUp: voice.keyUp,
    snip,
    toggleLock,
    toggleVisibility,
    newChat,
    move: move.toggle,
    scrollUp: () => scrollAnswers(-1),
    scrollDown: () => scrollAnswers(1),
    cycleOpacity: () => {
      const at = OPACITY_STEPS.findIndex((o) => o <= config.opacity + 0.001);
      setConfig({ opacity: OPACITY_STEPS[(at + 1) % OPACITY_STEPS.length] });
    },
    quit,
    settings: () => setShowSettings((s) => !s),
    fontUp: () => setFontSize(config.fontSize + 1),
    fontDown: () => setFontSize(config.fontSize - 1),
    fontReset: () => setFontSize(DEFAULT_CONFIG.fontSize),
  }, hotkeys, recordingShortcut || !license.licensed);

  // Settings closed: back to the question box
  const settingsWasOpen = useRef(false);
  useEffect(() => {
    if (settingsWasOpen.current && !showSettings && !locked) setFocusRequest((n) => n + 1);
    settingsWasOpen.current = showSettings;
  }, [showSettings, locked]);

  // Esc closes Settings
  useEffect(() => {
    if (!showSettings) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !recordingShortcut) setShowSettings(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showSettings, recordingShortcut]);

  // --- render ---------------------------------------------------------------

  const completion = useMemo(() => ({
    memory,
    vocabulary,
    conversation: conversationTerms(turns.map((t) => t.answer)),
  }), [memory, vocabulary, turns]);

  if (loading || !license.status) return null;

  const configured = Boolean(config.aiEndpoint && config.aiModel && config.aiApiKey);
  const style = {
    '--bg': config.bgColor,
    '--fg': config.textColor,
    '--fs': `${config.fontSize}px`,
    '--opacity': config.opacity,
  } as CSSProperties;

  if (!license.licensed) {
    return (
      <div className="app" style={style}>
        <Activation license={license} onQuit={quit} />
      </div>
    );
  }

  // The first time, the speech model downloads (in the background from startup)
  const downloaded = Math.floor((modelStatus.progress ?? 0) * 100);
  const modelNote = config.speechEngine !== 'local' || voice.phase === 'idle' ? null
    : modelStatus.state === 'downloading' ? `downloading the speech model, once · ${downloaded}%`
      : modelStatus.state === 'loading' ? 'loading the speech model' : null;

  const status = move.moving ? <MoveStatus /> : (
    <VoiceStatus
      phase={voice.phase}
      level={voice.level}
      since={voice.since}
      liveText={voice.liveText}
      modelNote={modelNote}
      note={note}
      holdToTalk={config.holdToTalk}
    />
  );

  const titleStatus = locked ? <span className="chip warn">Locked</span> : (
    <>
      {modelStatus.state === 'downloading' && (
        <span className="chip" title="The speech model for voice on this PC, downloaded once">Speech model {downloaded}%</span>
      )}
      {(updater.phase === 'available' || updater.phase === 'installing') && (
        <button
          className="chip accent"
          onClick={updater.install}
          disabled={updater.phase === 'installing'}
          title="Install it now: toyol closes for a moment and comes back updated"
        >
          {updater.phase === 'installing' ? 'Updating…' : `Update to ${updater.version}`}
        </button>
      )}
    </>
  );

  return (
    <div className={`app${locked ? ' locked' : ''}${move.moving ? ' moving' : ''}`} style={style}>
      <TitleBar
        locked={locked}
        status={titleStatus}
        canReset={turns.length > 0 || draft !== '' || image !== null}
        onNewChat={newChat}
        onToggleLock={toggleLock}
        onSettings={() => setShowSettings((s) => !s)}
        onHide={toggleVisibility}
        onQuit={quit}
      />
      {showSettings ? (
        <Settings
          config={config}
          setConfig={setConfig}
          modelStatus={modelStatus}
          updater={updater}
          license={license.status}
          onRecordingShortcut={setRecordingShortcut}
          onClose={() => setShowSettings(false)}
        />
      ) : (
        <>
          <Conversation
            turns={turns}
            scrollRef={conversationRef}
            autoScroll={config.autoScroll}
            onAsk={(q) => {
              send(q, 'typed', null);
              // Its button goes away as that answer folds
              setFocusRequest((n) => n + 1);
            }}
            empty={<Welcome configured={configured} hotkeys={hotkeys} holdToTalk={config.holdToTalk} onSettings={() => setShowSettings(true)} />}
          />
          {locked ? (
            <div className="composer">
              {status}
              <div className="locked-bar">
                <span>Clicks go through.</span>
                <span><kbd>{displayAccelerator(hotkeys.ask)}</kbd> type</span>
                <span><kbd>{displayAccelerator(hotkeys.voice)}</kbd> talk</span>
                <span><kbd>Esc</kbd> unlock</span>
              </div>
            </div>
          ) : (
            <Composer
              value={draft}
              onChange={setDraft}
              image={image}
              onRemoveImage={() => setImage(null)}
              busy={busy}
              listening={voice.phase === 'listening' || voice.phase === 'starting'}
              holdToTalk={config.holdToTalk}
              status={status}
              focusRequest={focusRequest}
              completion={completion}
              history={memory.questions}
              onSend={sendDraft}
              onStop={stop}
              onMicDown={voice.keyDown}
              onMicUp={voice.keyUp}
              onMic={voice.toggle}
              onSnip={snip}
              onPage={scrollAnswers}
            />
          )}
        </>
      )}
    </div>
  );
}

interface VoiceStatusProps {
  phase: ReturnType<typeof useVoice>['phase'];
  level: number;
  since: number;
  liveText: string; // what's been heard so far
  modelNote: string | null; // what the speech model is still doing for this request
  note: string | null;
  holdToTalk: boolean;
}

/**
 * Above the question box: listening (with a level meter, time, and what's been
 * heard so far), transcribing, or a short note
 */
function VoiceStatus({ phase, level, since, liveText, modelNote, note, holdToTalk }: VoiceStatusProps) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (phase !== 'listening') return;
    const timer = window.setInterval(() => tick((n) => n + 1), 500);
    return () => window.clearInterval(timer);
  }, [phase]);

  // Newest words at the bottom; the start scrolls out of sight
  const heard = liveText && phase !== 'idle' ? <div className="live-text"><span>{liveText}</span></div> : null;

  if (phase === 'listening' || phase === 'starting') {
    const seconds = phase === 'listening' ? Math.floor((Date.now() - since) / 1000) : 0;
    return (
      <>
        {heard}
        <div className="status listening" role="status">
          <span className="rec-dot" aria-hidden="true" />
          <span>{modelNote ? `Listening · ${modelNote}…` : 'Listening'}</span>
          <span className="meter" aria-hidden="true"><span style={{ transform: `scaleX(${Math.max(0.04, level)})` }} /></span>
          <span className="time">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span>
          <span className="status-hint">{holdToTalk ? 'let go to send' : 'press again or let go to send'}</span>
        </div>
      </>
    );
  }
  if (phase === 'transcribing') {
    return (
      <>
        {heard}
        <div className="status" role="status">
          <span className="spinner" aria-hidden="true" />
          {modelNote ? `${modelNote[0].toUpperCase()}${modelNote.slice(1)}…` : 'Transcribing…'}
        </div>
      </>
    );
  }
  if (note) return <div className="status note" role="status">{note}</div>;
  return null;
}

/** While moving the panel (useMovePanel): which keys do what */
function MoveStatus() {
  return (
    <div className="status moving" role="status">
      <span><kbd>Arrows</kbd> move</span>
      <span><kbd>Shift</kbd> to edge</span>
      <span><kbd>Ctrl</kbd> resize</span>
      <span><kbd>Enter</kbd> done</span>
    </div>
  );
}

function Welcome({ configured, hotkeys, holdToTalk, onSettings }: { configured: boolean; hotkeys: Hotkeys; holdToTalk: boolean; onSettings: () => void }) {
  return (
    <div className="welcome">
      {!configured && (
        <div className="welcome-card">
          <strong>Connect an AI service to start.</strong>
          <span>Any OpenAI-compatible endpoint works: OpenAI, Azure AI Foundry, …</span>
          <button className="primary-button" onClick={onSettings}>Open Settings</button>
        </div>
      )}
      <h2>Ask anything.</h2>
      <p>Type, speak, or pick part of the screen. The answer leads with one line you can read at a glance; the detail and likely follow-ups sit below it.</p>
      <ul className="welcome-keys">
        <li><kbd>{displayAccelerator(hotkeys.ask)}</kbd> Type a question</li>
        <li><kbd>{displayAccelerator(hotkeys.voice)}</kbd> Speak: {holdToTalk ? 'hold while talking' : 'tap, or hold while talking'}</li>
        <li><kbd>{displayAccelerator(hotkeys.snip)}</kbd> Screenshot: click two corners, or arrows and Enter</li>
        <li><kbd>{displayAccelerator(hotkeys.move)}</kbd> Move or resize with the arrow keys</li>
        <li><kbd>{displayAccelerator(hotkeys.toggleLock)}</kbd> Lock: clicks go through</li>
        <li><kbd>{displayAccelerator(hotkeys.toggleVisibility)}</kbd> Show / hide</li>
        <li><kbd>{displayAccelerator(hotkeys.scrollUp)}</kbd> <kbd>{displayAccelerator(hotkeys.scrollDown)}</kbd> Scroll the answers</li>
        <li><kbd>Tab</kbd> Accept a completion</li>
      </ul>
    </div>
  );
}

export default App;
