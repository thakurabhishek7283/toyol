import { useEffect, useMemo, useState, type ReactNode, type RefObject } from 'react';
import { listen } from '@tauri-apps/api/event';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import type { AutoScroll } from '../config';
import { useAutoScroll } from '../hooks/useAutoScroll';
import type { Turn } from '../hooks/useChat';
import { parseAnswer } from '../lib/answer';
import { renderMarkdown } from '../lib/markdown';
import { Icon } from './Icon';

interface ConversationProps {
  turns: Turn[];
  scrollRef: RefObject<HTMLDivElement | null>; // the scrolling list, for the scroll shortcuts
  empty: ReactNode; // shown before the first question
  autoScroll: AutoScroll; // how a new answer scrolls by
  onAsk: (question: string) => void; // a follow-up clicked
}

// Ctrl+wheel while locked (mouse hook): pixels per notch
const LOCKED_SCROLL_PX = 60;

/** The questions and answers, newest at the bottom */
function Conversation({ turns, scrollRef, empty, autoScroll, onAsk }: ConversationProps) {
  const last = turns[turns.length - 1];
  const lastId = last?.id;
  // Older answers fold down to the question and the glance; the latest shows in full.
  // Clicking "Details" flips that for a turn.
  const [flipped, setFlipped] = useState<Set<number>>(new Set());

  // A new question: its top comes into view, then the answer scrolls by as it's read
  useAutoScroll(scrollRef, lastId, last?.state === 'thinking' || last?.state === 'writing', autoScroll);

  // Ctrl+wheel over the locked panel scrolls the answers (see mouse_hook.rs)
  useEffect(() => {
    const unlisten = listen<number>('locked-scroll', ({ payload }) => {
      scrollRef.current?.scrollBy({ top: (-payload / 120) * LOCKED_SCROLL_PX });
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [scrollRef]);

  // Code blocks' copy buttons; links never navigate the panel
  const onClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('a')) e.preventDefault();
    const copy = target.closest<HTMLButtonElement>('.code-copy');
    const code = copy?.closest('.code-block')?.querySelector('code')?.textContent;
    if (copy && code) {
      writeText(code).then(() => {
        copy.textContent = 'Copied';
        window.setTimeout(() => (copy.textContent = 'Copy'), 1200);
      }).catch(() => {});
    }
  };

  const toggle = (id: number) => setFlipped((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  return (
    // Focusable, so the arrows and Page Up / Down scroll it
    <div className="conversation" ref={scrollRef} onClick={onClick} tabIndex={0} aria-label="Answers">
      {turns.length === 0 ? empty : turns.map((turn) => (
        <TurnView
          key={turn.id}
          turn={turn}
          expanded={(turn.id === lastId) !== flipped.has(turn.id)}
          onToggle={() => toggle(turn.id)}
          onAsk={onAsk}
        />
      ))}
    </div>
  );
}

interface TurnViewProps {
  turn: Turn;
  expanded: boolean;
  onToggle: () => void;
  onAsk: (question: string) => void;
}

function TurnView({ turn, expanded, onToggle, onAsk }: TurnViewProps) {
  const parsed = useMemo(() => parseAnswer(turn.answer), [turn.answer]);
  const glance = useMemo(() => renderMarkdown(parsed.glance), [parsed.glance]);
  const details = useMemo(() => (expanded && parsed.details ? renderMarkdown(parsed.details) : ''), [expanded, parsed.details]);
  const writing = turn.state === 'thinking' || turn.state === 'writing';
  const hasMore = parsed.details !== '' || parsed.followUps.length > 0;
  // What was typed or heard, under the question as understood, when it says something different
  const heard = turn.source === 'voice' || (parsed.question && turn.input && !sameText(parsed.question, turn.input));

  return (
    <article className="turn" data-turn={turn.id}>
      <header className="turn-question">
        <span className="q-mark" aria-hidden="true">Q</span>
        <h2>{parsed.question || turn.input || 'What’s on this screenshot?'}</h2>
      </header>
      {(heard || turn.image) && (
        <div className="turn-input">
          {turn.image && <img src={turn.image} alt="Screenshot sent" />}
          {heard && turn.input && (
            <span>
              {turn.source === 'voice' ? <Icon name="mic" size={11} /> : null} {turn.input}
            </span>
          )}
        </div>
      )}

      {turn.state === 'thinking' && <div className="turn-note thinking">Thinking…</div>}
      {glance && <div className="glance markdown" dangerouslySetInnerHTML={{ __html: glance }} />}

      {hasMore && (
        <button className="more-toggle" onClick={onToggle} aria-expanded={expanded}>
          <span className={`chevron${expanded ? ' open' : ''}`}><Icon name="chevron" size={12} /></span>
          {expanded ? 'Details' : `Details${parsed.followUps.length ? ' and follow-ups' : ''}`}
        </button>
      )}
      {expanded && details && <div className="details markdown" dangerouslySetInnerHTML={{ __html: details }} />}
      {expanded && parsed.followUps.length > 0 && (
        <ul className="follow-ups">
          {parsed.followUps.map((f) => (
            <li key={f.question}>
              <button onClick={() => onAsk(f.question)} disabled={writing} title="Ask this">
                <Icon name="arrow" size={12} /> {f.question}
              </button>
              {f.answer && <span dangerouslySetInnerHTML={{ __html: renderMarkdown(f.answer) }} />}
            </li>
          ))}
        </ul>
      )}

      {turn.state === 'writing' && <span className="caret" aria-hidden="true" />}
      {turn.state === 'stopped' && <div className="turn-note">Stopped.</div>}
      {turn.state === 'failed' && <div className="turn-note error">{turn.error}</div>}
      {turn.state === 'done' && (
        <button className="copy-answer" onClick={() => writeText(stripFormat(turn.answer)).catch(() => {})} title="Copy the answer">
          <Icon name="copy" size={12} /> Copy
        </button>
      )}
    </article>
  );
}

const plain = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const sameText = (a: string, b: string) => plain(a) === plain(b);

// The answer without the Q line, for pasting elsewhere
const stripFormat = (answer: string) => answer.replace(/^\s*(?:\*\*)?Q:[^\n]*\n+/, '').trim();

export default Conversation;
