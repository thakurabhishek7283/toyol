import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Icon } from './Icon';

interface TitleBarProps {
  locked: boolean;
  status: ReactNode; // what's going on (listening, transcribing...), if anything
  canReset: boolean;
  onNewChat: () => void;
  onToggleLock: () => void;
  onSettings: () => void;
  onHide: () => void;
  onQuit: () => void;
}

/** Drag handle and the panel's few buttons */
function TitleBar({ locked, status, canReset, onNewChat, onToggleLock, onSettings, onHide, onQuit }: TitleBarProps) {
  const lockRef = useRef<HTMLButtonElement>(null);

  // Tell the mouse hook where the lock button is (physical px in the window),
  // so Ctrl+click on it unlocks even though clicks go through while locked
  useLayoutEffect(() => {
    const button = lockRef.current;
    if (!button) return;
    const report = () => {
      const r = button.getBoundingClientRect();
      const s = window.devicePixelRatio;
      invoke('set_unlock_zone', {
        x: Math.round(r.left * s),
        y: Math.round(r.top * s),
        width: Math.round(r.width * s),
        height: Math.round(r.height * s),
      }).catch(() => {});
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(document.body);
    return () => observer.disconnect();
  }, [locked]);

  return (
    <header className="title-bar" data-tauri-drag-region>
      <div className="title-left" data-tauri-drag-region>
        <img src="/icon.png" alt="" className="title-icon" data-tauri-drag-region />
        <span className="title-name" data-tauri-drag-region>toyol</span>
        {status}
      </div>
      <div className="title-buttons">
        {!locked && (
          <button className="icon-button" onClick={onNewChat} disabled={!canReset} title="New conversation" aria-label="New conversation">
            <Icon name="plus" />
          </button>
        )}
        <button
          ref={lockRef}
          className={`icon-button${locked ? ' active-warn' : ''}`}
          onClick={onToggleLock}
          title={locked ? 'Locked: clicks go through. Esc or Ctrl+click here to unlock.' : 'Lock: let clicks go through to the app below'}
          aria-label={locked ? 'Unlock' : 'Lock'}
          aria-pressed={locked}
        >
          <Icon name={locked ? 'lock' : 'unlock'} />
        </button>
        {!locked && (
          <>
            <button className="icon-button" onClick={onSettings} title="Settings" aria-label="Settings">
              <Icon name="settings" />
            </button>
            <button className="icon-button" onClick={onHide} title="Hide (show again with the shortcut)" aria-label="Hide">
              <Icon name="minus" />
            </button>
            <button className="icon-button danger" onClick={onQuit} title="Quit" aria-label="Quit">
              <Icon name="close" />
            </button>
          </>
        )}
      </div>
    </header>
  );
}

export default TitleBar;
