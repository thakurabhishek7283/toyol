# toyol

A minimal AI question-and-answer panel for Windows that floats over everything else. Type,
speak, or click two corners of the screen; toyol works out what the question is and answers it
so the top of the answer reads at a glance, with depth and likely follow-ups underneath.

No documents, no notes, no search: just questions in and answers out.

## What it does

- **Works out the question.** Rambling voice input ("so um they asked me like how would you
  design a rate limiter…"), a bare topic ("cap theorem"), a follow-up ("example?") or a
  screenshot all become one clear question, shown above the answer.
- **Answers for a glance, with depth below.** Every answer leads with one bold sentence and a
  few key points. Under them: **Details** (how and why, an example, code) and **Follow-ups**
  (the likely next questions with short answers; click one to ask it). Older answers fold down
  to the question and the glance.
- **Voice input**, tuned for accuracy (see [Transcription](#transcription)). Tap the voice key to
  start and again to stop, or hold it while talking.
- **Screenshots by two clicks.** Click one corner of the area, then the opposite one: no holding
  the mouse button. Guide lines help line up the first corner, the area shows its size, and
  Esc or a right click cancels. A drag still works too.
- **Autocompletion as you type**: grey ghost text, `Tab` to accept (`→` takes one word), and a
  short list when there's more than one good guess. It completes question openings ("what's the
  diff" → "what's the difference between"), your own terms in your spelling ("grp" → "gRPC"),
  words from the current conversation, and questions you asked before, and it learns what you
  type next after a word. `↑` in an empty box brings back earlier questions.
- **An overlay**: always on top, out of the taskbar, hidden from screen shares and recordings
  (optional), with the arrow cursor kept whatever you do in it.
- **Lock**: clicks and scrolling go through to the app below. `Esc` or Ctrl+click on the lock
  unlocks; Ctrl+scroll over the panel scrolls the answers. The type shortcut unlocks until you
  click back into your app, then locks again; voice and screenshots work while locked.
- **Make it yours**: background opacity (what's behind shows through, the text stays solid),
  text size, panel and text colors, and every shortcut.

## Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Alt+Shift+A` | Type a question (unlocks until you click away) |
| `Ctrl+Alt+Shift+Space` | Speak: tap to start and stop, or hold while talking |
| `Ctrl+Alt+Shift+S` | Screenshot a region: click two corners |
| `Ctrl+Alt+Shift+L` | Lock / unlock |
| `Esc` | Unlock (while locked) |
| `Ctrl+Alt+Shift+H` | Show / hide |
| `Ctrl+Alt+Shift+N` | New conversation |
| `Ctrl+Alt+Shift+O` | Cycle opacity |
| `Ctrl+Alt+Shift+Q` | Quit |
| `Ctrl+,` | Settings (while the panel has focus) |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | Text size (while the panel has focus) |

The `Ctrl+Alt+Shift` ones work anywhere, even locked or with another app in front (Teams, Zoom
and Meet leave that combination free). Change any of them in Settings › Shortcuts.

## Setup

toyol answers with any OpenAI-compatible **Responses API**: OpenAI, Azure AI Foundry, and
others. Open Settings and enter the endpoint (e.g. `https://api.openai.com/v1`, or
`https://<resource>.services.ai.azure.com/openai/v1`), the model or deployment name, and your
API key. The key is stored in toyol's settings on your PC.

What leaves your PC: your questions, the screenshots you take, and (only with AI-service
transcription) your voice recordings, all sent to the service you configured. Local
transcription keeps your voice on the PC.

## Transcription

Voice runs on **Whisper small (English)**, bundled with the app, so it works offline from the
first launch and nothing you say leaves the PC. Around it:

- **Audio clean-up**: silence trimmed from both ends (no speech at all means nothing is sent,
  which stops Whisper "hearing" words in silence), the level evened out for quiet or distant
  mics, and recordings longer than 30 s split at pauses, each part carrying the end of the last
  as context.
- **A vocabulary prompt**: Settings › Voice › *Words to recognize* (prefilled with common
  engineering terms; add your own names and jargon) plus the conversation's last question steer
  Whisper towards the right spelling: "Redis", not "readies".
- **Guards against Whisper's failure modes**: loops collapsed, noise tags and phrases it invents
  in silence dropped, and a transcript that only echoes the prompt discarded.
- **On the GPU when it can**: the encoder (most of the work) runs on WebGPU in 16-bit, the
  decoder on the CPU in 8-bit, falling back to all-CPU if the GPU can't.

Measured with `npm run bench:speech` (spoken questions with jargon, made with Windows' voices and
degraded the way laptop mics degrade them), word error rate:

| | clean | fan noise | people talking | quiet mic | 30 s+ rambling question |
|---|---|---|---|---|---|
| whisper base.en, raw audio, no prompt | 8.3% | 11.1% | 9.7% | 9.0% | 81.9% |
| whisper base.en, toyol's pipeline | 2.8% | 6.3% | 8.3% | 4.2% | 5.6% |
| **whisper small.en, toyol's pipeline** | **2.1%** | **4.2%** | **2.8%** | **3.5%** | **1.4%** |

A typical spoken question takes about 2.5–3 s to transcribe on a laptop's built-in GPU (about
4 s CPU-only). For the most accuracy with strong accents, switch Settings › Voice ›
*Transcription* to **AI service** (e.g. `gpt-4o-transcribe`): the same clean-up and vocabulary
apply.

## Build from source

Needs Windows 10 (2004+) or 11, Node.js 20+ and [rustup](https://rustup.rs/).

```bash
npm install
npm run tauri:dev     # run it
npm run tauri:build   # installer in src-tauri/target/release/bundle/nsis/
```

Both first download the bundled speech model (~420 MB, pinned and checksummed, resumes if the
connection drops) into `src-tauri/resources/models/`. For development, put your AI service in
`.env.local` (gitignored) to skip Settings:

```
VITE_AI_ENDPOINT=https://api.openai.com/v1
VITE_AI_MODEL=<model>
VITE_AI_API_KEY=<key>
```

Other scripts: `npm test` (unit tests), `npm run bench:speech` (the transcription benchmark;
`BENCH_ABLATION=1` tries each clean-up step on its own), and `node scripts/try-answers.mjs
"question"` (shows how the AI service answers and how the answer splits up).

## Credits

The Windows overlay plumbing (capture exclusion, click-through lock with its Esc and Ctrl+click
hooks, the arrow-cursor fix, screen capture) and the bundled-model loading come from
[ScreenPrompt](https://github.com/dan0dev/ScreenPrompt) (MIT).

[MIT License](LICENSE)
