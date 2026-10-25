// Settings, saved in the app's config.json (useConfig)

import type { Tone } from './lib/ai';

export type SpeechEngine = 'local' | 'cloud';
export type AutoScroll = 'off' | 'slow' | 'medium' | 'fast';

export interface Config {
  // Window position (physical px; null until first placed) and size (logical px)
  x: number | null;
  y: number | null;
  width: number;
  height: number;
  locked: boolean; // clicks go through to the app below

  // Appearance
  opacity: number; // 0.2-1: how much of the desktop shows through
  fontSize: number;
  bgColor: string;
  textColor: string;
  hideFromCapture: boolean; // left out of screen shares, recordings and screenshots
  autoScroll: AutoScroll; // a new answer scrolls by at this reading pace (useAutoScroll)

  // Keyboard shortcuts changed in Settings, by HotkeyId (lib/hotkeys); the rest keep their defaults
  hotkeys: Record<string, string>;

  // The AI service: any OpenAI-compatible Responses API (OpenAI, Azure AI Foundry, ...)
  aiEndpoint: string; // base URL, e.g. https://api.openai.com/v1
  aiModel: string; // model or deployment name
  aiApiKey: string;
  tone: Tone; // how the answers are worded (lib/ai)
  customTone: string; // the user's own description, for tone 'custom'

  // Voice input
  speechEngine: SpeechEngine; // on this PC, or the AI service's transcription
  cloudSpeechModel: string; // e.g. gpt-4o-transcribe, or an Azure deployment name
  vocabulary: string; // names and jargon to recognize, comma-separated; also used by autocomplete
  micId: string; // '' = the system default
  holdToTalk: boolean; // listen only while the voice shortcut (or mic button) is held; else a tap also toggles
  autoSend: boolean; // send what was said (or a screenshot) right away, instead of waiting for Enter
}

// Dev builds take the AI service from .env.local (gitignored), so no key is
// committed. Release builds compile these to '' and users enter their own.
const DEV_AI = {
  endpoint: import.meta.env.DEV ? (import.meta.env.VITE_AI_ENDPOINT ?? '') : '',
  model: import.meta.env.DEV ? (import.meta.env.VITE_AI_MODEL ?? '') : '',
  apiKey: import.meta.env.DEV ? (import.meta.env.VITE_AI_API_KEY ?? '') : '',
};

// Common interview and engineering terms Whisper gets wrong on its own
// ("readies" for Redis, "Cuba Nets" for Kubernetes). A starting point to edit.
export const DEFAULT_VOCABULARY =
  'API, REST, GraphQL, gRPC, JSON, SQL, NoSQL, PostgreSQL, MySQL, MongoDB, Redis, Kafka, RabbitMQ, ' +
  'Kubernetes, Docker, AWS, Azure, GCP, CI/CD, OAuth, JWT, React, useEffect, useState, TypeScript, ' +
  'JavaScript, Node.js, Next.js, Python, Django, FastAPI, Java, Spring Boot, Go, Rust, C++, ' +
  'microservices, load balancer, rate limiter, cache, CDN, DNS, TCP, HTTP, WebSocket, LLM, RAG';

export const DEFAULT_CONFIG: Config = {
  x: null,
  y: null,
  width: 420,
  height: 560,
  locked: false,
  opacity: 0.95,
  fontSize: 15,
  bgColor: '#16181D',
  textColor: '#ECEEF2',
  hideFromCapture: true,
  autoScroll: 'slow',
  hotkeys: {},
  aiEndpoint: DEV_AI.endpoint,
  aiModel: DEV_AI.model,
  aiApiKey: DEV_AI.apiKey,
  tone: 'default',
  customTone: '',
  speechEngine: 'local',
  cloudSpeechModel: 'gpt-4o-transcribe',
  vocabulary: DEFAULT_VOCABULARY,
  micId: '',
  holdToTalk: false,
  autoSend: true,
};

export const MIN_FONT_SIZE = 11;
export const MAX_FONT_SIZE = 28;
export const OPACITY_STEPS = [1, 0.85, 0.7, 0.5];

// Panel colors: dark and light, each with a text color that reads on it
export const PANEL_COLORS: { bg: string; text: string }[] = [
  { bg: '#16181D', text: '#ECEEF2' }, // graphite
  { bg: '#000000', text: '#F2F2F2' }, // black
  { bg: '#14213A', text: '#E8EEFA' }, // navy
  { bg: '#12291F', text: '#E6F4EC' }, // forest
  { bg: '#2A1834', text: '#F3E9F7' }, // plum
  { bg: '#2E2216', text: '#F6EEE4' }, // espresso
  { bg: '#F4F5F7', text: '#1B1D22' }, // paper
  { bg: '#FFF8E1', text: '#2B2414' }, // cream
];

export const TEXT_COLORS = ['#ECEEF2', '#FFFFFF', '#C7CBD4', '#FFD866', '#7EE0A1', '#8CC8FF', '#1B1D22', '#000000'];

/** A text color that reads on `bg`: near-white on dark colors, near-black on light ones */
export function readableTextOn(bg: string): string {
  const hex = bg.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return luminance > 0.4 ? '#1B1D22' : '#ECEEF2';
}
