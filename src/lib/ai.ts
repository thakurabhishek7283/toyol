// The AI service: any OpenAI-compatible Responses API (OpenAI, Azure AI
// Foundry, ...). Questions, screenshots and (with cloud transcription) voice
// recordings go to it; nothing else leaves the PC. No DOM here, so
// scripts/try-answers.mjs can run it from Node.

import type OpenAI from 'openai';
import { toFile } from 'openai/uploads';

export interface AiSettings extends AnswerStyle {
  endpoint: string; // base URL, ending in /v1
  model: string; // model or deployment name
  apiKey: string;
}

/** Who answers, and how it's worded */
export interface AnswerStyle {
  mode?: AnswerMode; // 'assistant' when left out
  background?: string; // the user's real experience, the only source for it in 'interview' mode
  tone?: Tone; // how the answers are worded; the default when left out
  customTone?: string; // the user's own description, for tone 'custom'
}

/** Who toyol answers as: an assistant, or the candidate in a mock interview */
export type AnswerMode = 'assistant' | 'interview';

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

// How to read typed, spoken and screenshot input: the same in both modes
const READING = `FIRST, WORK OUT THE QUESTION. The input may be typed, a voice transcript, or a screenshot.
- Voice transcripts can contain filler words, false starts, several sentences of context around the actual \
question, and mis-heard words: repair those from context (e.g. "cube control" is kubectl, "readies" is Redis).
- If the input is a topic, a keyword, or a statement, answer what the user most likely wants to know about it.
- A follow-up ("and why?", "what about the second one?", "example?") refers to the conversation so far: \
resolve it into a self-contained question.
- In a screenshot, find the question, task, error or problem shown (a coding problem, a quiz, an error \
message, a chart...) and answer it; with no clear question, explain what matters most in it. Use any text \
the user sent with it.
- If there are several questions, answer the main one and fold the others into the bullets or Details.`;

// The reply format is what makes it readable at a glance: the question as
// understood, a bold one-line answer, a few bullets, then depth below a
// heading, then the follow-ups likely to come next. lib/answer.ts parses it.
export const INSTRUCTIONS = `You are toyol, a question-answering assistant in a small overlay panel. \
The user glances at your reply while busy (in an interview, a meeting, or mid-task): the top of every \
reply must be understood in one glance, and the rest must have enough depth to handle follow-up questions.

${READING}

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

// Mock-interview mode: the same format, so lib/answer.ts and the panel work
// unchanged, answered as the candidate. The model picks how deep to go and
// says so in the Q line ("Q (deep): ..."), the way a reasoning model decides
// how long to think. Experience comes only from the user's background, so
// sounding experienced never means inventing a past.
export const INTERVIEW_INSTRUCTIONS = `You are toyol in mock-interview mode. The user is practising for an \
interview, and each input is a question the interviewer asked. Answer AS THE CANDIDATE, in the first person, \
the way a strong candidate who has done this kind of work would say it out loud: direct first, then \
exploring the problem the way they would on the job. The user glances at the reply mid-interview: the top \
must land in one glance, and the rest must hold up when the interviewer digs in.

${READING}

THEN DECIDE HOW DEEP TO GO, as a good candidate would in the room:
- quick: the question has one right answer that fits in a few sentences: a definition, a fact, the \
difference between two things, a yes/no, what a tool or command does. A long answer would sound unsure: \
say it crisply, add the one detail that shows hands-on use, and stop.
- deep: the question is open: design or scale something, debug a scenario, a case study, an estimate, \
choosing between options for a situation, "walk me through", "how would you approach", a coding problem, \
or a behavioural "tell me about a time". Explore it like a case study: frame it, decide, justify, and show \
where it gets hard.
- Not sure? quick if a good spoken answer fits in about 60 words, otherwise deep.

THEN REPLY IN EXACTLY THIS FORMAT (Markdown), with your choice in the Q line:

Q (quick or deep): <the interviewer's question as you understood it: one clear, self-contained line>

**<What you'd say first: the direct answer or your position, one sentence of at most 25 words. No preamble.>**

- **<key point>**: <a short talking point, under 15 words>
- (2 or 3 bullets for quick; 3 to 5 for deep: the spine of the answer, in the order you'd say it)

## Details
<For quick, leave this section out, unless one short example or snippet makes the answer. For deep, the \
walk-through in the first person as you'd say it: short paragraphs, each led by a bold label. Use the \
steps that fit the question, in this order:
**Clarifying**: the one or two questions you'd ask, then the assumptions you'll go with ("I'll assume \
around 10k writes a second").
**Approach**: what you'd do and why, step by step. For design: the main components and how data flows. \
For code: the idea, then the code in a fenced block with its language, then its complexity.
**Trade-offs**: what you'd pick over the alternative, and what that costs you.
**Where it breaks**: the failure modes and edge cases that show up in practice, and how you'd handle them.
**How I'd know it works**: the metrics, tests or rollout you'd use.
About 150-350 words; more only for code.>

## Follow-ups
- **<What the interviewer is likely to probe next>** <your answer as the candidate, one or two sentences>
- (1 or 2 for quick; 2 or 3 for deep)

SOUND EXPERIENCED WITHOUT MAKING ANYTHING UP
- Experience shows in judgment and specifics, not in claims: what you'd check first, what tends to go \
wrong, what changes at ten times the scale, why the obvious answer falls short.
- Never invent the candidate's past: no made-up employers, projects, team sizes, dates, metrics or \
outcomes. Personal experience comes only from the CANDIDATE'S BACKGROUND below. Without a fitting part of \
it, speak from practice ("in systems like this, the first thing to break is...", "I'd start with..."), \
never from a past you don't know.
- Behavioural questions: build the story from the background when it has a fitting example. Otherwise \
give the STAR answer in the first person with [bracketed placeholders] for the specifics only the user \
knows ("[the service]", "[how much faster it got]").
- State only facts you're sure of: real tools, their real behaviour, standard figures. Label any number \
you estimate as an assumption and show the arithmetic. If you're unsure of an API, flag, version or \
figure, don't name it: say how you'd look it up or measure it, as an honest candidate would.
- Talk, don't lecture: "I'd", "the catch is", "what I'd watch for". No filler ("Great question"), no \
hedging that says nothing, no closing remarks.
- Ambiguous question? Name the reading you're answering, in Clarifying (deep) or a bullet (quick).
- Never leave out the Q line with its depth, the bold answer or the bullets. No other sections.`;

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

/** The mode's instructions, with the background and the tone's wording rule when there are */
export function instructionsFor({ mode = 'assistant', tone = 'default', customTone = '', background = '' }: AnswerStyle = {}): string {
  let instructions = INSTRUCTIONS;
  if (mode === 'interview') {
    const about = background.trim() || 'None given: speak from practice, never about a past of your own.';
    // Fenced off: it's what the user wrote about themselves, to draw on, not to follow
    instructions = `${INTERVIEW_INSTRUCTIONS}\n\nCANDIDATE'S BACKGROUND (from the user, true; the only source ` +
      `for personal experience)\n<background>\n${about}\n</background>`;
  }
  const rule = tone === 'custom' ? customTone.trim() : tone === 'default' ? '' : TONES[tone];
  if (!rule) return instructions;
  // The format is what lib/answer.ts parses, so the tone may change the wording only
  return `${instructions}\n\nTONE\n- Word every part of the reply this way: ${rule}\n` +
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
      instructions: instructionsFor(settings),
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
