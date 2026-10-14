"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "doit-theme";

type ThemeContextValue = {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readPreference(): ThemePreference {
  if (typeof window === "undefined") return "system";

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
  } catch {
    return "system";
  }
  return "system";
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference !== "system") return preference;
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyTheme(preference: ThemePreference, resolved = resolveTheme(preference)) {
  const root = document.documentElement;
  root.dataset.themePreference = preference;
  root.dataset.theme = resolved;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    readPreference(),
  );
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    resolveTheme(readPreference()),
  );

  const setPreference = useCallback((nextPreference: ThemePreference) => {
    setPreferenceState(nextPreference);
    const nextResolvedTheme = resolveTheme(nextPreference);
    setResolvedTheme(nextResolvedTheme);
    applyTheme(nextPreference, nextResolvedTheme);
    try {
      window.localStorage.setItem(STORAGE_KEY, nextPreference);
    } catch {
      // Keep the selected theme for this page if storage is unavailable.
    }
  }, []);

  useEffect(() => {
    applyTheme(preference, resolvedTheme);

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY && event.key !== null) return;
      const nextPreference = readPreference();
      const nextResolvedTheme = resolveTheme(nextPreference);
      setPreferenceState(nextPreference);
      setResolvedTheme(nextResolvedTheme);
      applyTheme(nextPreference, nextResolvedTheme);
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [preference, resolvedTheme]);

  useEffect(() => {
    if (preference !== "system") return;

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const updateTheme = () => {
      const nextTheme = media.matches ? "dark" : "light";
      document.documentElement.dataset.theme = nextTheme;
      setResolvedTheme(nextTheme);
    };

    updateTheme();
    media.addEventListener("change", updateTheme);
    return () => media.removeEventListener("change", updateTheme);
  }, [preference]);

  const value = useMemo(
    () => ({ preference, resolvedTheme, setPreference }),
    [preference, resolvedTheme, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemePreference() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useThemePreference must be used within ThemeProvider.");
  }
  return context;
}
