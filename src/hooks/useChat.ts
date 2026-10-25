import { useCallback, useEffect, useRef, useState } from 'react';
import { describeError, streamAnswer, userMessage, type AiSettings, type ChatMessage, type InputSource } from '../lib/ai';

/** A question and its answer */
export interface Turn {
  id: number;
  input: string; // as typed or heard
  source: InputSource;
  image?: string; // a screenshot (data URL)
  answer: string; // so far, while writing
  state: 'thinking' | 'writing' | 'done' | 'stopped' | 'failed';
  error?: string;
}

// Exchanges sent along with a question, so follow-ups make sense without every
// request growing: the latest ones
const MAX_HISTORY_TURNS = 6;

let nextId = 1;

/**
 * The conversation. `ask` sends a question (typed, spoken, or a screenshot)
 * and streams its answer in; asking again while an answer is still coming
 * stops that one first.
 */
export function useChat(settings: AiSettings) {
  const [turns, setTurnsState] = useState<Turn[]>([]);
  const turnsRef = useRef<Turn[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  });

  const setTurns = useCallback((next: Turn[]) => {
    turnsRef.current = next;
    setTurnsState(next);
  }, []);

  const patch = useCallback((id: number, change: Partial<Turn>) => {
    setTurns(turnsRef.current.map((t) => (t.id === id ? { ...t, ...change } : t)));
  }, [setTurns]);

  const ask = useCallback(async (input: string, source: InputSource, image?: string) => {
    const text = input.trim();
    if (!text && !image) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Earlier answers, finished or cut short, are the context; a screenshot
    // goes along only with its own question (re-sending it every time is slow)
    const history: ChatMessage[] = turnsRef.current
      .filter((t) => t.answer && t.state !== 'failed')
      .slice(-MAX_HISTORY_TURNS)
      .flatMap((t) => [
        userMessage(t.image ? `${t.input} [screenshot sent earlier]`.trim() : t.input, t.image ? 'typed' : t.source),
        { role: 'assistant' as const, content: t.answer },
      ]);

    const turn: Turn = { id: nextId++, input: text, source, image, answer: '', state: 'thinking' };
    setTurns([...turnsRef.current.map((t) => (t.state === 'thinking' || t.state === 'writing' ? { ...t, state: 'stopped' as const } : t)), turn]);

    const { endpoint, model, apiKey } = settingsRef.current;
    if (!endpoint.trim() || !model.trim() || !apiKey.trim()) {
      patch(turn.id, { state: 'failed', error: 'Add the AI service (endpoint, model and API key) in Settings.' });
      return;
    }

    try {
      const answer = await streamAnswer(
        settingsRef.current,
        [...history, userMessage(text, source, image)],
        (partial) => {
          if (!controller.signal.aborted) patch(turn.id, { answer: partial, state: 'writing' });
        },
        controller.signal,
      );
      if (!controller.signal.aborted) patch(turn.id, { answer: answer || 'No answer came back.', state: 'done' });
    } catch (error) {
      if (controller.signal.aborted) return;
      console.error('Answer failed:', error);
      patch(turn.id, { state: 'failed', error: await describeError(error) });
    }
  }, [patch, setTurns]);

  /** Stop the answer being written, keeping what's there */
  const stop = useCallback(() => {
    abortRef.current?.abort();
    setTurns(turnsRef.current.map((t) => (t.state === 'thinking' || t.state === 'writing' ? { ...t, state: 'stopped' } : t)));
  }, [setTurns]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setTurns([]);
  }, [setTurns]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const busy = turns.some((t) => t.state === 'thinking' || t.state === 'writing');
  return { turns, busy, ask, stop, reset };
}
