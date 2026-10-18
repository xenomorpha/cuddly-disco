// UI strings are externalised through t(). English strings are the keys;
// locales map them to translations (spec §10: English at launch, Russian second).

import { useStore } from './model/store';
import ru from './locales/ru.json';

const LOCALES: Record<string, Record<string, string>> = { ru };

export function t(s: string, vars?: Record<string, string | number>): string {
  const loc = useStore.getState().ui.locale;
  let out = (loc !== 'en' && LOCALES[loc]?.[s]) || s;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.replace(`{${k}}`, String(v));
  return out;
}

/** Subscribe a component to locale changes. */
export function useLocale() {
  return useStore((s) => s.ui.locale);
}
