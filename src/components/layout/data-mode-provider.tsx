"use client";

import { createContext, useCallback, useContext, useState } from "react";

type DataMode = "demo" | "live";

type DataModeContextValue = {
  mode: DataMode;
  isDemo: boolean;
  setMode: (m: DataMode) => void;
};

const DataModeContext = createContext<DataModeContextValue>({
  mode: "live",
  isDemo: false,
  setMode: () => {},
});

const STORAGE_KEY = "nexus-data-mode";

export function DataModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<DataMode>(() => {
    // typeof window guard: during SSR localStorage doesn't exist; default to live.
    if (typeof window === "undefined") return "live";
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "demo" || stored === "live" ? stored : "live";
  });

  const setMode = useCallback((m: DataMode) => {
    setModeState(m);
    localStorage.setItem(STORAGE_KEY, m);
  }, []);

  return (
    <DataModeContext.Provider value={{ mode, isDemo: mode === "demo", setMode }}>
      {children}
    </DataModeContext.Provider>
  );
}

export function useDataMode() {
  return useContext(DataModeContext);
}
