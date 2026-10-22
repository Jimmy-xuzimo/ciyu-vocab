export type Appearance = 'system' | 'light' | 'dark';
export type Palette = 'forest' | 'ocean' | 'violet' | 'amber';
export interface Preferences { appearance: Appearance; palette: Palette }
export const PREFERENCES_KEY = 'lexiday-preferences-v1';

export function readPreferences(): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? '{}');
    return {
      appearance: ['system', 'light', 'dark'].includes(saved.appearance) ? saved.appearance : 'system',
      palette: ['forest', 'ocean', 'violet', 'amber'].includes(saved.palette) ? saved.palette : 'forest',
    };
  } catch { return { appearance: 'system', palette: 'forest' }; }
}

export function greeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 5) return '夜深了';
  if (hour < 11) return '早上好';
  if (hour < 13) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}
