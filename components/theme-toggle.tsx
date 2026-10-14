"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type ThemePreference = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "doit-theme";

function getResolvedTheme(preference: ThemePreference): ResolvedTheme {
  if (preference !== "system") return preference;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyTheme(preference: ThemePreference) {
  const root = document.documentElement;
  root.dataset.themePreference = preference;
  root.dataset.theme = getResolvedTheme(preference);
}

export function ThemeToggle() {
  const [preference, setPreference] = useState<ThemePreference>("system");
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("light");

  useEffect(() => {
    let savedPreference: ThemePreference = "system";
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "light" || stored === "dark" || stored === "system") {
        savedPreference = stored;
      }
    } catch {
      // The pre-render initializer already applied the system theme.
    }

    setPreference(savedPreference);
    setResolvedTheme(getResolvedTheme(savedPreference));
    applyTheme(savedPreference);
  }, []);

  useEffect(() => {
    if (preference !== "system") return;

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const updateTheme = () => {
      const resolved = media.matches ? "dark" : "light";
      document.documentElement.dataset.theme = resolved;
      setResolvedTheme(resolved);
    };

    updateTheme();
    media.addEventListener("change", updateTheme);
    return () => media.removeEventListener("change", updateTheme);
  }, [preference]);

  function selectPreference(value: string) {
    if (value !== "light" && value !== "dark" && value !== "system") return;

    setPreference(value);
    const resolved = getResolvedTheme(value);
    setResolvedTheme(resolved);
    applyTheme(value);
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // Theme changes remain active for this page even if storage is unavailable.
    }
  }

  const Icon = resolvedTheme === "dark" ? Moon : Sun;
  const preferenceLabel =
    preference.charAt(0).toUpperCase() + preference.slice(1);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="theme-toggle"
          aria-label={`Theme: ${preferenceLabel}. Choose color theme.`}
          title={`Theme: ${preferenceLabel}`}
        >
          <Icon aria-hidden="true" />
          <span className="sr-only">Choose color theme</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="theme-menu">
        <DropdownMenuLabel>Appearance</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={preference}
          onValueChange={selectPreference}
          aria-label="Color theme preference"
        >
          <DropdownMenuRadioItem value="light">
            <Sun aria-hidden="true" />
            Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon aria-hidden="true" />
            Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor aria-hidden="true" />
            System
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
