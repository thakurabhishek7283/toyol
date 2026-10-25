// Answers are Markdown from the AI service: rendered here, then sanitized,
// since the text isn't ours.

import DOMPurify from 'dompurify';
import { Marked, type Tokens } from 'marked';

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const marked = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    // Code blocks get a copy button (handled in Conversation) and their language as a label
    code({ text, lang }: Tokens.Code) {
      const language = (lang ?? '').split(/\s/)[0];
      return `<div class="code-block"><div class="code-bar"><span>${escapeHtml(language)}</span>`
        + `<button type="button" class="code-copy" data-copy>Copy</button></div>`
        + `<pre><code>${escapeHtml(text)}</code></pre></div>`;
    },
    // Links don't navigate the panel away (clicks are ignored); the address shows on hover
    link({ href, tokens }: Tokens.Link) {
      return `<a title="${escapeHtml(href)}">${this.parser.parseInline(tokens)}</a>`;
    },
  },
});

export function renderMarkdown(text: string): string {
  return DOMPurify.sanitize(marked.parse(text, { async: false }));
}
