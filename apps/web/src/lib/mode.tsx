import { createContext, useCallback, useContext, useEffect, useState } from 'react';

export type InterfaceMode = 'simple' | 'quant';

const STORAGE_KEY = 'memecoin-lab.ui-mode';

/** Simple Mode is the default for anyone without a saved preference. */
export function getStoredMode(): InterfaceMode {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'quant' ? 'quant' : 'simple';
  } catch {
    return 'simple';
  }
}

export function storeMode(mode: InterfaceMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // storage unavailable — mode still works for this session
  }
}

interface ModeContextValue {
  mode: InterfaceMode;
  setMode: (mode: InterfaceMode) => void;
}

const ModeContext = createContext<ModeContextValue>({ mode: 'simple', setMode: () => {} });

export function ModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<InterfaceMode>(() => getStoredMode());
  const setMode = useCallback((next: InterfaceMode) => {
    setModeState(next);
    storeMode(next);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.uiMode = mode;
  }, [mode]);
  return <ModeContext.Provider value={{ mode, setMode }}>{children}</ModeContext.Provider>;
}

export function useMode(): ModeContextValue {
  return useContext(ModeContext);
}
