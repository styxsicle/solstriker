import { useMode } from '../lib/mode';

/**
 * Simple/Quant interface switch. Persisted, no page reload.
 * Simple Mode explains the same real data in ordinary language;
 * Quant Mode shows every raw technical field.
 */
export function ModeToggle() {
  const { mode, setMode } = useMode();
  return (
    <div className="mode-toggle" role="group" aria-label="Interface mode">
      <button
        className={`mode-btn ${mode === 'simple' ? 'active' : ''}`}
        aria-pressed={mode === 'simple'}
        onClick={() => setMode('simple')}
        title="Plain-language explanations of the same data"
      >
        Simple
      </button>
      <button
        className={`mode-btn ${mode === 'quant' ? 'active' : ''}`}
        aria-pressed={mode === 'quant'}
        onClick={() => setMode('quant')}
        title="Full technical detail: raw values, exact decimals, decoder fields"
      >
        Quant
      </button>
    </div>
  );
}
