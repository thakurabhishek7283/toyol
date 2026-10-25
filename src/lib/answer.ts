// Splits a reply in the format lib/ai.ts asks for into its parts, so the
// panel can show the question as understood, the at-a-glance answer, and the
// depth below it. Works on a reply that's still streaming in.

export interface FollowUp {
  question: string;
  answer: string; // Markdown
}

export interface ParsedAnswer {
  question: string; // as the model understood it; '' until its line arrives
  glance: string; // the bold answer and key points (Markdown)
  details: string; // Markdown
  followUps: FollowUp[];
}

const Q_LINE = /^\s*(?:\*\*)?Q:(?:\*\*)?\s*([^\n]*)(\n|$)/;
const HEADING = /^#{1,4}\s*\**\s*(details|follow[- ]?ups?)\s*\**\s*:?\s*$/gim;
const FOLLOW_UP = /^\s*(?:[-*]|\d+\.)\s+\*\*(.+?)\*\*\s*[:\-–—]?\s*(.*)$/;

/** A heading that's still arriving ("## Det") isn't text to show */
const dropPartialHeading = (text: string) => text.replace(/\n#{1,4}[^\n]*$/, '').replace(/^#{1,4}[^\n]*$/, '');

export function parseAnswer(text: string): ParsedAnswer {
  let body = text.replace(/\r/g, '');
  let question = '';

  const q = Q_LINE.exec(body);
  if (q) {
    question = q[1].replace(/\*\*$/, '').trim();
    body = body.slice(q[0].length);
  } else if (/^\s*(?:\*\*)?Q?:?$/.test(body)) {
    // The start of the Q line
    body = '';
  }

  const sections: { name: 'details' | 'followUps'; start: number; end: number }[] = [];
  for (const match of body.matchAll(HEADING)) {
    sections.push({
      name: match[1].toLowerCase() === 'details' ? 'details' : 'followUps',
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  const glanceEnd = sections.length > 0 ? sections[0].start : body.length;
  const glance = dropPartialHeading(body.slice(0, glanceEnd)).trim();
  let details = '';
  let followUpText = '';
  sections.forEach((section, i) => {
    const content = body.slice(section.end, i + 1 < sections.length ? sections[i + 1].start : body.length);
    if (section.name === 'details') details += content;
    else followUpText += content;
  });

  return {
    question,
    glance,
    details: dropPartialHeading(details).trim(),
    followUps: parseFollowUps(dropPartialHeading(followUpText)),
  };
}

function parseFollowUps(text: string): FollowUp[] {
  const items: FollowUp[] = [];
  for (const line of text.split('\n')) {
    const item = FOLLOW_UP.exec(line);
    if (item) items.push({ question: item[1].trim(), answer: item[2].trim() });
    else if (line.trim() && items.length > 0) items[items.length - 1].answer += ` ${line.trim()}`;
  }
  return items;
}
