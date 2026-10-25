import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { suggest, type SuggestContext, type Suggestion } from '../lib/autocomplete';
import { Icon } from './Icon';

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  image: string | null; // a screenshot to send with the question
  onRemoveImage: () => void;
  busy: boolean; // an answer is being written
  listening: boolean;
  status: ReactNode; // voice progress or a short note, above the box
  focusRequest: number; // changes when the box should take focus
  completion: SuggestContext;
  history: string[]; // questions asked before, most recent first (↑ / ↓)
  onSend: () => void;
  onStop: () => void;
  onMic: () => void;
  onSnip: () => void;
}

const MAX_LINES = 6;

/** The question box, with completion as you type */
function Composer(props: ComposerProps) {
  const { value, onChange, image, busy, listening, completion, history } = props;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const [caretAtEnd, setCaretAtEnd] = useState(true);
  const [selected, setSelected] = useState(-1); // in the list; -1 = none picked
  const [dismissed, setDismissed] = useState(false);
  const historyAt = useRef(-1); // ↑/↓ position in `history`; -1 = the draft

  const suggestions = useMemo<Suggestion[]>(
    () => (caretAtEnd && value.trim() ? suggest(value, completion) : []),
    [value, caretAtEnd, completion],
  );
  const active = !dismissed && suggestions.length > 0;
  const best = active ? suggestions[selected >= 0 ? selected : 0] : null;
  const ghost = focused && best ? best.text.slice(value.length) : '';
  const showList = focused && active && suggestions.length > 1;

  useEffect(() => {
    if (props.focusRequest > 0) inputRef.current?.focus();
  }, [props.focusRequest]);

  // Grow with the text, up to MAX_LINES
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = 'auto';
    const line = parseFloat(getComputedStyle(input).lineHeight) || 20;
    const padding = input.offsetHeight - input.clientHeight + parseFloat(getComputedStyle(input).paddingTop) * 2;
    input.style.height = `${Math.min(input.scrollHeight, line * MAX_LINES + padding)}px`;
  }, [value]);

  const update = (next: string) => {
    onChange(next);
    setSelected(-1);
    setDismissed(false);
    historyAt.current = -1;
  };

  const accept = (s: Suggestion, wholeWordOnly = false) => {
    let text = s.text;
    if (wholeWordOnly) {
      // Just the next word of it
      const rest = s.text.slice(value.length);
      const word = /^\s*\S+/.exec(rest);
      text = value + (word ? word[0] : rest);
    }
    // A finished word gets its space, ready for the next one
    if ((s.kind === 'word' || s.kind === 'next') && text === s.text) text += ' ';
    update(text);
  };

  const recall = (step: 1 | -1) => {
    if (history.length === 0) return false;
    const next = Math.max(-1, Math.min(history.length - 1, historyAt.current + step));
    if (next === historyAt.current) return true;
    historyAt.current = next;
    onChange(next === -1 ? '' : history[next]);
    setDismissed(true);
    return true;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    switch (e.key) {
      case 'Enter':
        if (e.shiftKey) return;
        e.preventDefault();
        if (showList && selected >= 0) accept(suggestions[selected]);
        else if (!busy) props.onSend();
        return;
      case 'Tab':
        if (best && !e.shiftKey) {
          e.preventDefault();
          accept(best);
        }
        return;
      case 'ArrowRight':
        if (best && caretAtEnd && (e.ctrlKey || !e.shiftKey)) {
          e.preventDefault();
          accept(best, true);
        }
        return;
      case 'ArrowDown':
      case 'ArrowUp': {
        const down = e.key === 'ArrowDown';
        if (showList) {
          e.preventDefault();
          setSelected((i) => (down ? Math.min(suggestions.length - 1, i + 1) : Math.max(-1, i - 1)));
        } else if ((!value || historyAt.current !== -1) && recall(down ? -1 : 1)) {
          e.preventDefault();
        }
        return;
      }
      case 'Escape':
        if (active) {
          e.preventDefault();
          setDismissed(true);
        } else if (busy) {
          e.preventDefault();
          props.onStop();
        }
        return;
    }
  };

  const trackCaret = () => {
    const input = inputRef.current;
    if (input) setCaretAtEnd(input.selectionStart === input.value.length && input.selectionEnd === input.value.length);
  };

  return (
    <div className="composer">
      {props.status}
      {showList && (
        <ul className="suggestions" role="listbox">
          {suggestions.map((s, i) => (
            <li
              key={s.text}
              role="option"
              aria-selected={i === selected}
              className={i === selected ? 'selected' : ''}
              onMouseDown={(e) => {
                e.preventDefault(); // keep focus in the box
                accept(s);
              }}
            >
              <span className={`kind kind-${s.kind}`}>{s.kind === 'question' ? 'asked' : s.kind === 'phrase' ? 'phrase' : 'word'}</span>
              {s.label}
            </li>
          ))}
        </ul>
      )}
      {image && (
        <div className="attachment">
          <img src={image} alt="Screenshot to send" />
          <span>Screenshot attached</span>
          <button className="icon-button" onClick={props.onRemoveImage} title="Remove" aria-label="Remove screenshot">
            <Icon name="close" size={13} />
          </button>
        </div>
      )}
      <div className={`input-row${focused ? ' focused' : ''}`}>
        <div className="input-wrap">
          {/* The same text behind the box, with the completion after it in grey */}
          <div className="input-mirror" ref={mirrorRef} aria-hidden="true">
            <span className="mirror-text">{value}</span>
            <span className="ghost">{ghost}</span>
          </div>
          <textarea
            ref={inputRef}
            className="input"
            rows={1}
            value={value}
            placeholder={image ? 'Add a question about it, or press Enter' : 'Ask anything…'}
            spellCheck={false}
            onChange={(e) => update(e.target.value)}
            onKeyDown={onKeyDown}
            onKeyUp={trackCaret}
            onClick={trackCaret}
            onSelect={trackCaret}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onScroll={(e) => {
              if (mirrorRef.current) mirrorRef.current.scrollTop = e.currentTarget.scrollTop;
            }}
            aria-label="Question"
            aria-autocomplete="list"
          />
        </div>
        <div className="input-buttons">
          <button className={`icon-button${listening ? ' active-danger' : ''}`} onClick={props.onMic} title={listening ? 'Stop and send' : 'Speak your question'} aria-label="Voice input" aria-pressed={listening}>
            <Icon name="mic" />
          </button>
          <button className="icon-button" onClick={props.onSnip} title="Screenshot a region (two clicks)" aria-label="Screenshot a region">
            <Icon name="snip" />
          </button>
          {busy ? (
            <button className="send-button stop" onClick={props.onStop} title="Stop (Esc)" aria-label="Stop">
              <Icon name="stop" size={13} />
            </button>
          ) : (
            <button className="send-button" onClick={props.onSend} disabled={!value.trim() && !image} title="Send (Enter)" aria-label="Send">
              <Icon name="send" size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default Composer;
