// The AI service: any OpenAI-compatible Responses API (OpenAI, Azure AI
// Foundry, ...). Questions, screenshots and (with cloud transcription) voice
// recordings go to it; nothing else leaves the PC. No DOM here, so
// scripts/try-answers.mjs can run it from Node.

import type OpenAI from 'openai';
import { toFile } from 'openai/uploads';

export interface AiSettings {
  endpoint: string; // base URL, ending in /v1
  model: string; // model or deployment name
  apiKey: string;
  tone?: Tone; // how the answers are worded; the default when left out
  customTone?: string; // the user's own description, for tone 'custom'
}

/** How the answers are worded, without changing their format */
export type Tone = 'default' | 'conversational' | 'professional' | 'simple' | 'technical' | 'custom';

// Each tone's wording rule, added to the instructions ('custom' is the user's own)
const TONES: Record<Exclude<Tone, 'default' | 'custom'>, string> = {
  conversational: 'Conversational and natural, like a colleague talking it through: plain words, contractions, ' +
    'short sentences that are easy to say out loud.',
  professional: 'Polished and professional: precise, confident and formal; no slang, no filler.',
  simple: 'Simple: everyday words, as if to a smart newcomer; explain any jargon you need in a few words, and ' +
    'prefer an analogy to a definition.',
  technical: 'Technical and dense: exact terminology, specifics and numbers, for an expert reader; skip the basics.',
};

/** How a question came in, which tells the model how to read it */
export type InputSource = 'typed' | 'voice' | 'screen';

export type MessageContent =
  | string
  | ({ type: 'input_text'; text: string } | { type: 'input_image'; image_url: string; detail: 'high' })[];

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: MessageContent;
}

// The reply format is what makes it readable at a glance: the question as
// understood, a bold one-line answer, a few bullets, then depth below a
// heading, then the follow-ups likely to come next. lib/answer.ts parses it.
export const INSTRUCTIONS = `You are toyol, a question-answering assistant in a small overlay panel. \
The user glances at your reply while busy (in an interview, a meeting, or mid-task): the top of every \
reply must be understood in one glance, and the rest must have enough depth to handle follow-up questions.

FIRST, WORK OUT THE QUESTION. The input may be typed, a voice transcript, or a screenshot.
- Voice transcripts can contain filler words, false starts, several sentences of context around the actual \
question, and mis-heard words: repair those from context (e.g. "cube control" is kubectl, "readies" is Redis).
- If the input is a topic, a keyword, or a statement, answer what the user most likely wants to know about it.
- A follow-up ("and why?", "what about the second one?", "example?") refers to the conversation so far: \
resolve it into a self-contained question.
- In a screenshot, find the question, task, error or problem shown (a coding problem, a quiz, an error \
message, a chart...) and answer it; with no clear question, explain what matters most in it. Use any text \
the user sent with it.
- If there are several questions, answer the main one and fold the others into the bullets or Details.

THEN REPLY IN EXACTLY THIS FORMAT (Markdown):

Q: <the question as you understood it: one clear, self-contained line>

**<The direct answer in one sentence of at most 25 words. No preamble, no restating the question.>**

- **<key term or step>**: <short point, under 15 words>
- (3 to 5 bullets in total: the essential facts, steps, reasons or numbers)

## Details
<The depth: how and why it works, a concrete example, trade-offs, edge cases or pitfalls. Short paragraphs, \
lists, a table, or a fenced code block with its language, whichever makes it clearest. About 80-250 words; \
more only when the question needs it (code, step-by-step math).>

## Follow-ups
- **<A likely next question>** <answer in one or two sentences>
- (2 or 3 in total)

RULES
- Never leave out the Q line, the bold answer or the bullets. No other sections, no closing remarks.
- Be specific and correct; prefer concrete numbers, names and examples over generalities.
- If the question is ambiguous, answer the most likely meaning and name the other in one bullet.
- If you don't know, or the input has no answerable question, say so plainly in the bold line.
- For code: the bold line states the approach, the bullets the key ideas and complexity, the full code \
goes in Details.
- For calculations: the bold line gives the result, the working goes in Details.
- For behavioral or interview questions ("tell me about a time..."): the bold line is the core message, the \
bullets a STAR outline, Details a short sample answer in the first person.`;

// Room for the answer, and for reasoning on models that reason first
const MAX_OUTPUT_TOKENS = 6000;

/** The user's question as sent to the model */
export function userMessage(input: string, source: InputSource, image?: string): ChatMessage {
  const text = input.trim();
  if (source === 'screen' || image) {
    const note = text ? `\nMy note: ${text}` : '';
    return {
      role: 'user',
      content: [
        { type: 'input_text', text: `Screenshot of part of my screen.${note}` },
        // High detail: screen text is small, and reading it is the point
        ...(image ? [{ type: 'input_image' as const, image_url: image, detail: 'high' as const }] : []),
      ],
    };
  }
  if (source === 'voice') return { role: 'user', content: `Voice transcript (may contain mis-heard words): ${text}` };
  return { role: 'user', content: text };
}

/** The instructions, with the tone's wording rule when there is one */
export function instructionsFor(tone: Tone = 'default', customTone = ''): string {
  const rule = tone === 'custom' ? customTone.trim() : tone === 'default' ? '' : TONES[tone];
  if (!rule) return INSTRUCTIONS;
  // The format is what lib/answer.ts parses, so the tone may change the wording only
  return `${INSTRUCTIONS}\n\nTONE\n- Word every part of the reply this way: ${rule}\n` +
    '- The tone changes only the wording: keep the format above exactly (the Q line, the bold answer, the ' +
    'bullets, Details, Follow-ups) and stay just as correct.';
}

let cached: { key: string; client: OpenAI } | null = null;

async function clientFor(settings: AiSettings): Promise<OpenAI> {
  const key = `${settings.endpoint}\n${settings.apiKey}`;
  if (cached?.key !== key) {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({
      baseURL: settings.endpoint.trim().replace(/\/+$/, ''),
      apiKey: settings.apiKey.trim(),
      // The SDK guards against shipping a key in a public web page. This is a
      // desktop app with the user's own key, kept in their settings on this PC.
      dangerouslyAllowBrowser: true,
      maxRetries: 1, // an answer that comes late is little use
    });
    cached = { key, client };
  }
  return cached.client;
}

/**
 * Answer the last message of a conversation, streaming: `onText` gets the
 * answer so far as it's written. Resolves to the whole answer. Abort `signal`
 * to stop (rejects with the SDK's APIUserAbortError).
 */
export async function streamAnswer(
  settings: AiSettings,
  messages: ChatMessage[],
  onText: (text: string) => void,
  signal: AbortSignal,
): Promise<string> {
  const client = await clientFor(settings);
  const stream = await client.responses.create(
    {
      model: settings.model.trim(),
      instructions: instructionsFor(settings.tone, settings.customTone),
      input: messages,
      max_output_tokens: MAX_OUTPUT_TOKENS,
      stream: true,
    },
    { signal },
  );

  let text = '';
  for await (const event of stream) {
    if (event.type === 'response.output_text.delta') {
      text += event.delta;
      onText(text);
    } else if (event.type === 'error') {
      throw new Error(event.message);
    } else if (event.type === 'response.failed') {
      throw new Error(event.response.error?.message ?? 'The AI service could not answer');
    }
  }
  return text.trim();
}

/** Speech to text with the AI service's transcription model (e.g. gpt-4o-transcribe) */
export async function transcribeCloud(settings: AiSettings, model: string, wav: ArrayBuffer, prompt: string): Promise<string> {
  const client = await clientFor(settings);
  const { NotFoundError } = await import('openai');
  try {
    const result = await client.audio.transcriptions.create({
      file: await toFile(new Uint8Array(wav), 'speech.wav', { type: 'audio/wav' }),
      model: model.trim(),
      language: 'en',
      prompt: prompt || undefined,
      temperature: 0,
    });
    return result.text;
  } catch (error) {
    // The usual cause: the AI service has no transcription model by that name
    // (on Azure, a deployment of e.g. gpt-4o-transcribe)
    if (error instanceof NotFoundError) {
      throw new Error(`The AI service has no speech model "${model.trim()}". Deploy one, or switch Voice to "On this PC" in Settings.`);
    }
    throw error;
  }
}

/** What went wrong, in words for the panel */
export async function describeError(error: unknown): Promise<string> {
  const { APIConnectionError, AuthenticationError, BadRequestError, NotFoundError, PermissionDeniedError, RateLimitError } =
    await import('openai');
  if (error instanceof BadRequestError && /image/i.test(error.message)) {
    return "This model can't read screenshots. Pick one that takes images in Settings.";
  }
  if (error instanceof AuthenticationError || error instanceof PermissionDeniedError) {
    return 'The API key was rejected. Check it in Settings.';
  }
  if (error instanceof NotFoundError) return 'No such model or deployment. Check the endpoint and model in Settings.';
  if (error instanceof RateLimitError) return 'The AI service is busy. Try again in a moment.';
  if (error instanceof APIConnectionError) return "Can't reach the AI service. Check your connection.";
  return error instanceof Error ? error.message : String(error);
}
