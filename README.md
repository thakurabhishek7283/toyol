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
- **Hands-free reading**: a new answer jumps to the top of the panel, wherever you'd scrolled.
  A long one waits as long as reading five lines takes at the set pace (time for the question
  and the bold answer), then scrolls down slowly to the end (Settings › Appearance › *Auto-scroll
  answers*: off, slow, medium or fast). Scrolling yourself stops it until the next answer.
- **Voice input**, tuned for accuracy (see [Transcription](#transcription)). Tap the voice key (or
  the mic button) to start and again to stop, or hold it while talking. With Settings › Voice ›
  **Hold to talk**, it listens only while held: let go and it sends.
- **Screenshots by two clicks.** Click one corner of the area, then the opposite one: no holding
  the mouse button. Guide lines help line up the first corner, the area shows its size, and
  Esc or a right click cancels. A drag still works too. Without the mouse: the arrows move the
  guide lines (`Shift`+arrow to that edge), `Enter` picks a corner, `Ctrl+A` takes the whole
  screen.
- **Move and resize from the keyboard.** The move shortcut takes the arrow keys until `Enter` or
  `Esc`, even locked or with another app in front: arrows move the panel (hold to keep going),
  `Shift`+arrow sends it to that edge of the screen, `Ctrl`+arrow resizes it.
- **No mouse needed.** `Tab` goes through every button and setting, the answers scroll with the
  arrows and Page Up / Down once focused (or from the question box with Page Up / Down, or from
  anywhere with the scroll shortcuts), and focus comes back to the question box after Settings,
  a new conversation or a follow-up.
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
  text size, panel and text colors, and every shortcut. Settings › Answers › **Tone** sets how
  answers are worded (conversational, professional, simple, technical, or your own description)
  while keeping their layout.

## Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Alt+Shift+A` | Type a question (unlocks until you click away) |
| `Ctrl+Alt+Shift+Space` | Speak: tap to start and stop, or hold while talking |
| `Ctrl+Alt+Shift+S` | Screenshot a region: click two corners, or arrows and `Enter` |
| `Ctrl+Alt+Shift+M` | Move (arrows) or resize (`Ctrl`+arrows) the panel; `Enter` when done |
| `Ctrl+Alt+Shift+PgUp` / `PgDn` | Scroll the answers |
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

Voice runs on **Whisper medium (English)** in [whisper.cpp](https://github.com/ggml-org/whisper.cpp),
on the PC, so nothing you say leaves it. The model (~820 MB) isn't in the installer, which keeps
installs and updates small: it downloads once in the background at the first start (progress in
the title bar; pinned, checksummed, and resumed if the connection drops), then works offline and
survives updates. Around it:

- **Transcribed as you talk**: the text shows above the question box while you speak, and
  there's next to nothing left to do when you stop. Whisper doesn't stream, so the part of the
  recording not yet settled is transcribed again about three times a second (a pass takes about
  a quarter of a second on a GPU); past 12 s it's settled at a pause, and passes carry on from
  there with its text as context. When you stop, the latest pass usually already heard
  everything; if not, only the end since the last pause is transcribed once more.
- **On the GPU**: through Vulkan, which every graphics driver provides, preferring a dedicated
  GPU over a laptop's built-in one; on the CPU if there's no usable GPU.
- **Audio clean-up**: silence trimmed from both ends (no speech at all means nothing is sent,
  which stops Whisper "hearing" words in silence) and the level evened out for quiet or distant
  mics.
- **A vocabulary prompt**: Settings › Voice › *Words to recognize* (prefilled with common
  engineering terms; add your own names and jargon) plus the conversation's last question steer
  Whisper towards the right spelling: "Redis", not "readies".
- **Guards against Whisper's failure modes**: loops collapsed, noise tags and phrases it invents
  in silence dropped, and a transcript that only echoes the prompt discarded.

Measured with `npm run bench:speech` (spoken questions with jargon, made with Windows' voices and
degraded the way laptop mics degrade them, played in real time), on a laptop RTX 5050:

| | clean | fan noise | people talking | quiet mic | 30 s+ rambling question |
|---|---|---|---|---|---|
| word errors | 0.7% | 1.4% | 0.7% | 0.7% | 1.4% |
| jargon terms right | 17/18 | 17/18 | 17/18 | 17/18 | 11/12 |
| wait after you stop (median) | 8 ms | 10 ms | 0.4 s | 31 ms | 28 ms |

With people talking in the background, the voices after yours keep the end of the recording
"busy", so one last pass runs after you stop. Before streaming, whisper small in the webview took
2.5–3 s after you stopped, with 2–4% word errors. For strong accents, Settings › Voice ›
*Transcription* › **AI service** (e.g. `gpt-4o-transcribe`) gets the same clean-up and vocabulary,
without the live text.

## Build from source

Needs Windows 10 (2004+) or 11, Node.js 20+ and [rustup](https://rustup.rs/).

```bash
npm install
npm run tauri:dev     # run it: the interface reloads as you edit, the Rust side rebuilds
npm run tauri:build   # installer in <Cargo's target folder>/release/bundle/nsis/
```

`tauri:dev` first downloads the speech model into `src-tauri/resources/models/`, which
development builds use. Builds are signed for the updater, so `tauri:build` needs the signing key
in `TAURI_SIGNING_PRIVATE_KEY` (see [Releases](#releases)).

whisper.cpp is built with the app, which also needs Visual Studio's C++ tools (with its CMake),
the [Vulkan SDK](https://vulkan.lunarg.com/sdk/home#windows), and libclang (from
[LLVM](https://releases.llvm.org/), or the `libclang` package on PyPI). Set `VULKAN_SDK`, `CMAKE`
and `LIBCLANG_PATH` to them, or edit `src-tauri/.cargo/config.toml`, which also points Cargo's
output at a short folder: whisper.cpp's build goes deeper than Windows' 260-character path
limit allows under a long project path.

For development, put your AI service in
`.env.local` (gitignored) to skip Settings:

```
VITE_AI_ENDPOINT=https://api.openai.com/v1
VITE_AI_MODEL=<model>
VITE_AI_API_KEY=<key>
```

Other scripts: `npm test` (unit tests), `npm run bench:speech` (the transcription benchmark:
accuracy and the wait after you stop, with the app's engine; give it other whisper.cpp models
to compare, or `BENCH_BATCH=1` to transcribe each clip only once it ends), and `node
scripts/try-answers.mjs "question"` (shows how the AI service answers and how the answer splits
up).

## Releases

Installed copies update themselves from this repository's
[GitHub releases](https://github.com/thakurabhishek7283/toyol/releases). They look at startup and
every six hours; a newer version shows as **Update to x.y.z** in the title bar (and in Settings ›
About), and installs only when clicked: toyol closes for a few seconds and comes back updated,
settings and speech model kept. Installing a newer installer by hand upgrades in place too.

To publish one, from a clean, committed tree:

```bash
npm run release -- 0.2.0 "What changed"
```

It sets the version (package.json, which tauri.conf.json reads, and Cargo.toml), builds the
signed installer, commits "Release 0.2.0", tags `v0.2.0`, pushes, and creates the release with
the installer and the `latest.json` the app checks. It needs the
[GitHub CLI](https://cli.github.com/), signed in (`gh auth login`), and the signing key from
`npx tauri signer generate -w ~/.tauri/toyol.key`, whose public half is in tauri.conf.json.
**Back up the key**: installed copies accept only updates signed with it, so without it they can't
be updated again.

## Credits

The Windows overlay plumbing (capture exclusion, click-through lock with its Esc and Ctrl+click
hooks, the arrow-cursor fix, screen capture) and the model download script come from
[ScreenPrompt](https://github.com/dan0dev/ScreenPrompt) (MIT).

[MIT License](LICENSE)
