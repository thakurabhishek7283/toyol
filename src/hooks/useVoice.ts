import { useCallback, useEffect, useRef, useState } from 'react';
import type { AiSettings } from '../lib/ai';
import { MIN_SPEECH_SECONDS, SAMPLE_RATE } from '../lib/speech/audio';
import { loadSpeechModel, localPasses, transcribeCloudSpeech } from '../lib/speech/engine';
import { LiveTranscript } from '../lib/speech/live';
import { recordedAudio, startRecording, stopRecording } from '../lib/speech/recorder';

export type VoicePhase = 'idle' | 'starting' | 'listening' | 'transcribing';

// Held at least this long, the voice key is push-to-talk (letting go stops);
// a shorter tap starts listening until the next tap. With holdToTalk, letting
// go always stops.
const HOLD_MS = 450;
// How often the live transcript gets the recording so far (it decides when to run a pass)
const LIVE_UPDATE_MS = 100;

export interface TranscribeOptions {
  engine: 'local' | 'cloud';
  prompt: string; // see buildPrompt
  ai: AiSettings; // for the cloud engine
  cloudModel: string;
}

interface VoiceOptions {
  options: () => TranscribeOptions; // read when listening starts
  micId: string;
  holdToTalk: boolean;
  preload: boolean; // load the local model ahead of time
  onText: (text: string) => void;
  onNote: (message: string) => void;
}

/**
 * Voice input. `keyDown`/`keyUp` follow the voice shortcut and the mic button:
 * tap to start and tap again to stop, or hold while talking (only that, with
 * `holdToTalk`). `toggle` is for a click with no press and release (a screen
 * reader's). On this PC, speech is transcribed while it's heard (`liveText`);
 * when listening stops, what was said is handed to `onText`.
 */
export function useVoice({ options, micId, holdToTalk, preload, onText, onNote }: VoiceOptions) {
  const [phase, setPhaseState] = useState<VoicePhase>('idle');
  const [level, setLevel] = useState(0);
  const [since, setSince] = useState(0);
  const [liveText, setLiveText] = useState('');
  const phaseRef = useRef<VoicePhase>('idle');
  const latest = useRef({ options, micId, holdToTalk, onText, onNote });
  useEffect(() => {
    latest.current = { options, micId, holdToTalk, onText, onNote };
  });

  const setPhase = (next: VoicePhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  };

  const stopRequested = useRef(false);
  // While listening: the options it started with, and on this PC the live transcript
  const session = useRef<{ options: TranscribeOptions; live: LiveTranscript | null; timer: number } | null>(null);

  const finish = useCallback(async () => {
    if (phaseRef.current === 'starting') {
      // Still opening the microphone: stop as soon as it's open
      stopRequested.current = true;
      return;
    }
    if (phaseRef.current !== 'listening') return;
    const current = session.current;
    session.current = null;
    if (current) window.clearInterval(current.timer);
    setPhase('transcribing');
    setLevel(0);
    const audio = await stopRecording();
    if (!current || !audio || audio.length < SAMPLE_RATE * MIN_SPEECH_SECONDS) {
      setPhase('idle');
      setLiveText('');
      latest.current.onNote('Too short: keep talking a moment longer');
      return;
    }
    try {
      const { options: o, live } = current;
      const text = live ? await live.finish(audio) : await transcribeCloudSpeech(audio, o.ai, o.cloudModel, o.prompt);
      if (text) latest.current.onText(text);
      else latest.current.onNote("Didn't catch that. Try again a little closer to the mic.");
    } catch (error) {
      console.error('Transcription failed:', error);
      latest.current.onNote(`Couldn't transcribe: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setPhase('idle');
      setLiveText('');
    }
  }, []);

  const begin = useCallback(async () => {
    if (phaseRef.current !== 'idle') return;
    stopRequested.current = false;
    setPhase('starting');
    try {
      await startRecording(latest.current.micId, setLevel, () => finish());
      const options = latest.current.options();
      const live = options.engine === 'local' ? new LiveTranscript(localPasses, options.prompt, setLiveText) : null;
      const timer = window.setInterval(() => {
        const audio = recordedAudio();
        if (live && audio) live.update(audio);
      }, LIVE_UPDATE_MS);
      session.current = { options, live, timer };
      setPhase('listening');
      setSince(Date.now());
      if (stopRequested.current) finish();
    } catch (error) {
      console.error('Microphone failed:', error);
      setPhase('idle');
      latest.current.onNote("Can't use the microphone. Check Windows Settings › Privacy › Microphone, or pick another in Settings.");
    }
  }, [finish]);

  const toggle = useCallback(() => {
    if (phaseRef.current === 'idle') begin();
    else finish();
  }, [begin, finish]);

  // The voice shortcut and the mic button
  const keyHeld = useRef(false);
  const pressedAt = useRef(0);
  const stoppedOnPress = useRef(false);

  const keyDown = useCallback(() => {
    if (keyHeld.current) return; // key repeat
    keyHeld.current = true;
    if (phaseRef.current === 'idle') {
      stoppedOnPress.current = false;
      pressedAt.current = Date.now();
      begin();
    } else {
      stoppedOnPress.current = true;
      finish();
    }
  }, [begin, finish]);

  const keyUp = useCallback(() => {
    if (!keyHeld.current) return;
    keyHeld.current = false;
    if (stoppedOnPress.current) {
      stoppedOnPress.current = false;
      return;
    }
    if (latest.current.holdToTalk || Date.now() - pressedAt.current >= HOLD_MS) finish();
  }, [finish]);

  // Load the bundled model in the background, so the first question isn't slow
  useEffect(() => {
    if (preload) loadSpeechModel().catch(() => {}); // a failure shows in the model status
  }, [preload]);

  return { phase, level, since, liveText, toggle, keyDown, keyUp };
}
