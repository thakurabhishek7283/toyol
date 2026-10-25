import { useCallback, useEffect, useRef, useState } from 'react';
import { MIN_SPEECH_SECONDS, SAMPLE_RATE } from '../lib/speech/audio';
import { preloadSpeechModel, transcribe, type TranscribeOptions } from '../lib/speech/engine';
import { startRecording, stopRecording } from '../lib/speech/recorder';

export type VoicePhase = 'idle' | 'starting' | 'listening' | 'transcribing';

// Held at least this long, the voice key is push-to-talk (letting go stops);
// a shorter tap starts listening until the next tap
const HOLD_MS = 450;

interface VoiceOptions {
  options: () => TranscribeOptions; // read when a recording stops
  micId: string;
  preload: boolean; // load the local model ahead of time
  onText: (text: string) => void;
  onNote: (message: string) => void;
}

/**
 * Voice input. `keyDown`/`keyUp` follow the voice shortcut: tap to start and
 * tap again to stop, or hold while talking. `toggle` is the mic button. When
 * listening stops, what was said is transcribed and handed to `onText`.
 */
export function useVoice({ options, micId, preload, onText, onNote }: VoiceOptions) {
  const [phase, setPhaseState] = useState<VoicePhase>('idle');
  const [level, setLevel] = useState(0);
  const [since, setSince] = useState(0);
  const phaseRef = useRef<VoicePhase>('idle');
  const latest = useRef({ options, micId, onText, onNote });
  useEffect(() => {
    latest.current = { options, micId, onText, onNote };
  });

  const setPhase = (next: VoicePhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  };

  const stopRequested = useRef(false);

  const finish = useCallback(async () => {
    if (phaseRef.current === 'starting') {
      // Still opening the microphone: stop as soon as it's open
      stopRequested.current = true;
      return;
    }
    if (phaseRef.current !== 'listening') return;
    setPhase('transcribing');
    setLevel(0);
    const audio = await stopRecording();
    if (!audio || audio.length < SAMPLE_RATE * MIN_SPEECH_SECONDS) {
      setPhase('idle');
      latest.current.onNote('Too short: keep talking a moment longer');
      return;
    }
    try {
      const text = await transcribe(audio, latest.current.options());
      if (text) latest.current.onText(text);
      else latest.current.onNote("Didn't catch that. Try again a little closer to the mic.");
    } catch (error) {
      console.error('Transcription failed:', error);
      latest.current.onNote(`Couldn't transcribe: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setPhase('idle');
    }
  }, []);

  const begin = useCallback(async () => {
    if (phaseRef.current !== 'idle') return;
    stopRequested.current = false;
    setPhase('starting');
    try {
      await startRecording(latest.current.micId, setLevel, () => finish());
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

  // The voice shortcut
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
    keyHeld.current = false;
    if (stoppedOnPress.current) {
      stoppedOnPress.current = false;
      return;
    }
    if (Date.now() - pressedAt.current >= HOLD_MS) finish();
  }, [finish]);

  // Load the bundled model in the background, so the first question isn't slow
  useEffect(() => {
    if (preload) preloadSpeechModel().catch(() => {}); // a failure shows in the model status
  }, [preload]);

  return { phase, level, since, toggle, keyDown, keyUp };
}
