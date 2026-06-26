'use client';

import { useEffect, useState } from 'react';

export type ThemePreference = 'auto' | 'light' | 'dark';

const THEME_KEY = 'sudokusquad:theme';
const preferences: ThemePreference[] = ['auto', 'light', 'dark'];

let currentPreference: ThemePreference = 'auto';
const listeners = new Set<() => void>();

function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'auto' || value === 'light' || value === 'dark';
}

function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolvedTheme(preference: ThemePreference): 'light' | 'dark' {
  if (preference === 'auto') return systemPrefersDark() ? 'dark' : 'light';
  return preference;
}

function applyTheme(preference: ThemePreference) {
  const resolved = resolvedTheme(preference);
  document.documentElement.classList.toggle('dark', resolved === 'dark');
  document.documentElement.dataset.theme = preference;
  document.documentElement.style.colorScheme = resolved;
}

function readStoredPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    return isThemePreference(stored) ? stored : 'auto';
  } catch {
    return 'auto';
  }
}

function emit() {
  for (const listener of listeners) listener();
}

export function initThemePreference(): ThemePreference {
  currentPreference = readStoredPreference();
  applyTheme(currentPreference);
  return currentPreference;
}

export function getThemePreference(): ThemePreference {
  return currentPreference;
}

export function getThemeOptions(): ThemePreference[] {
  return preferences;
}

export function setThemePreference(preference: ThemePreference) {
  currentPreference = preference;
  try {
    window.localStorage.setItem(THEME_KEY, preference);
  } catch {
    // Ignore storage failures; the in-memory preference still applies.
  }
  applyTheme(preference);
  emit();
}

export function subscribeToThemePreference(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useThemePreference() {
  const [preference, setPreferenceState] = useState<ThemePreference>('auto');

  useEffect(() => {
    setPreferenceState(initThemePreference());

    const unsubscribe = subscribeToThemePreference(() => {
      setPreferenceState(getThemePreference());
    });
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onSystemThemeChange = () => {
      if (getThemePreference() === 'auto') {
        applyTheme('auto');
        emit();
      }
    };

    media.addEventListener('change', onSystemThemeChange);
    return () => {
      unsubscribe();
      media.removeEventListener('change', onSystemThemeChange);
    };
  }, []);

  return { preference, setPreference: setThemePreference };
}
