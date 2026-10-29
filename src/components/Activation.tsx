import { useState, type FormEvent } from 'react';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import type { useLicense } from '../hooks/useLicense';
import { Icon } from './Icon';

// Where customers send their PC's code for a key (scripts/license.mjs signs it)
const CONTACT = 'thakurabhishek7283@gmail.com';

interface ActivationProps {
  license: ReturnType<typeof useLicense>;
  onQuit: () => void;
}

/**
 * In place of the panel until toyol is licensed on this PC (useLicense): the
 * PC's code to send, and a box for the key that comes back
 */
function Activation({ license, onQuit }: ActivationProps) {
  const [key, setKey] = useState('');
  const [copied, setCopied] = useState(false);
  const { status, busy, error } = license;
  const problem = error || status?.message;
  const code = status?.machineCode ?? '';

  const copy = () => {
    writeText(code).then(() => setCopied(true)).catch(() => {});
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (key.trim() && !busy) license.activate(key);
  };

  return (
    <>
      <header className="title-bar" data-tauri-drag-region>
        <div className="title-left" data-tauri-drag-region>
          <img src="/icon.png" alt="" className="title-icon" data-tauri-drag-region />
          <span className="title-name" data-tauri-drag-region>toyol</span>
        </div>
        <div className="title-buttons">
          <button className="icon-button danger" onClick={onQuit} title="Quit" aria-label="Quit">
            <Icon name="close" />
          </button>
        </div>
      </header>
      <form className="activation" onSubmit={submit}>
        <h2>Activate toyol</h2>
        <p>
          toyol needs a license key made for this PC. Email this code to <span className="contact">{CONTACT}</span>;
          the key you get back goes below.
        </p>
        {code && (
          <div className="field">
            <span className="field-label">This PC's code</span>
            <div className="machine-code">
              <code>{code}</code>
              <button type="button" className="text-button" onClick={copy}>
                <Icon name="copy" /> {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        )}
        <label className="field">
          <span className="field-label">License key</span>
          <textarea
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Paste your key"
            rows={4}
            spellCheck={false}
            autoComplete="off"
            autoFocus
          />
        </label>
        <button type="submit" className="primary-button" disabled={busy || !key.trim()}>
          {busy ? 'Activating…' : 'Activate'}
        </button>
        {problem && <div className="activation-error" role="alert">{problem}</div>}
      </form>
    </>
  );
}

export default Activation;
