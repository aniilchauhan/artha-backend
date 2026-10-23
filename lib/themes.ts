export type ThemeId =
  | 'dark'       // Midnight Obsidian (Classic dark)
  | 'light'      // Alpine Daylight (Classic light)
  | 'emerald'    // Matrix Cyber Terminal (Phosphor green)
  | 'amber'      // Wall Street Bloomberg (Amber gold)
  | 'cyberpunk'  // Tokyo Synthwave (Neon pink & cyan)
  | 'nordic'     // Arctic Glacier (Frosty ice blue & teal)
  | 'amethyst'   // Royal Velvet (Deep violet amethyst)
  | 'crimson'    // Apex Crimson (Momentum red & carbon)
  | 'sunset'     // Solar Dusk (Warm tangerine & twilight)
  | 'quantum';   // Quantum OLED (Pure 0% black & white)

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  tagline: string;
  category: 'Classic' | 'Cyber' | 'Financial' | 'Vibrant' | 'Minimal';
  isDark: boolean;
  colors: {
    primary: string;
    secondary: string;
    canvas: string;
    surface: string;
    raised: string;
    border: string;
    text: string;
    muted: string;
  };
  accentName: string;
}

export const THEMES: ThemeDefinition[] = [
  {
    id: 'dark',
    name: 'Midnight Obsidian',
    tagline: 'Deep slate obsidian with electric indigo & violet glow',
    category: 'Classic',
    isDark: true,
    accentName: 'Indigo Electric',
    colors: {
      primary: '#6366f1',
      secondary: '#a855f7',
      canvas: '#0c0c0e',
      surface: '#171719',
      raised: '#262629',
      border: '#333337',
      text: '#f5f5f7',
      muted: '#a1a1ab',
    },
  },
  {
    id: 'light',
    name: 'Alpine Daylight',
    tagline: 'Crisp high-clarity day mode with cobalt blue precision',
    category: 'Classic',
    isDark: false,
    accentName: 'Cobalt Blue',
    colors: {
      primary: '#075ccb',
      secondary: '#0284c7',
      canvas: '#f3f5f8',
      surface: '#ffffff',
      raised: '#e9eef5',
      border: '#d2dce9',
      text: '#17243a',
      muted: '#626f82',
    },
  },
  {
    id: 'emerald',
    name: 'Matrix Terminal',
    tagline: 'Cybernetic phosphor green on high-contrast carbon',
    category: 'Cyber',
    isDark: true,
    accentName: 'Phosphor Green',
    colors: {
      primary: '#10b981',
      secondary: '#059669',
      canvas: '#040d07',
      surface: '#0a180e',
      raised: '#122619',
      border: '#184227',
      text: '#ecfdf5',
      muted: '#6ee7b7',
    },
  },
  {
    id: 'amber',
    name: 'Wall St Bloomberg',
    tagline: 'Classic financial trading desk in warm amber gold & espresso',
    category: 'Financial',
    isDark: true,
    accentName: 'Amber Gold',
    colors: {
      primary: '#f59e0b',
      secondary: '#d97706',
      canvas: '#0e0c08',
      surface: '#19150e',
      raised: '#282116',
      border: '#423521',
      text: '#fef3c7',
      muted: '#fbbf24',
    },
  },
  {
    id: 'cyberpunk',
    name: 'Tokyo Synthwave',
    tagline: 'Futuristic neon magenta & cyan over midnight violet',
    category: 'Cyber',
    isDark: true,
    accentName: 'Neon Magenta',
    colors: {
      primary: '#ec4899',
      secondary: '#06b6d4',
      canvas: '#0c0817',
      surface: '#160e29',
      raised: '#251642',
      border: '#3d236d',
      text: '#fdf2f8',
      muted: '#f472b6',
    },
  },
  {
    id: 'nordic',
    name: 'Arctic Glacier',
    tagline: 'Calm frosty cyan & teal on deep Nordic slate',
    category: 'Vibrant',
    isDark: true,
    accentName: 'Glacier Blue',
    colors: {
      primary: '#38bdf8',
      secondary: '#2dd4bf',
      canvas: '#070e17',
      surface: '#0e1a2b',
      raised: '#16273e',
      border: '#1f3a5c',
      text: '#f0f9ff',
      muted: '#7dd3fc',
    },
  },
  {
    id: 'amethyst',
    name: 'Royal Velvet',
    tagline: 'Regal obsidian with radiant violet & lavender hues',
    category: 'Vibrant',
    isDark: true,
    accentName: 'Royal Amethyst',
    colors: {
      primary: '#a855f7',
      secondary: '#c084fc',
      canvas: '#0d0617',
      surface: '#180b2a',
      raised: '#271144',
      border: '#431b73',
      text: '#faf5ff',
      muted: '#d8b4fe',
    },
  },
  {
    id: 'crimson',
    name: 'Apex Crimson',
    tagline: 'Aggressive momentum trader theme in carbon & fiery red',
    category: 'Financial',
    isDark: true,
    accentName: 'Apex Crimson',
    colors: {
      primary: '#ef4444',
      secondary: '#f43f5e',
      canvas: '#0e0608',
      surface: '#1a0b10',
      raised: '#291119',
      border: '#4a1d29',
      text: '#fff1f2',
      muted: '#fda4af',
    },
  },
  {
    id: 'sunset',
    name: 'Solar Dusk',
    tagline: 'Warm horizon twilight with solar tangerine & coral rose',
    category: 'Vibrant',
    isDark: true,
    accentName: 'Solar Tangerine',
    colors: {
      primary: '#f97316',
      secondary: '#fb7185',
      canvas: '#100806',
      surface: '#1c0e0b',
      raised: '#2b1712',
      border: '#4c261e',
      text: '#fff7ed',
      muted: '#fdba74',
    },
  },
  {
    id: 'quantum',
    name: 'Quantum OLED',
    tagline: 'True 0% black OLED with crisp titanium white precision',
    category: 'Minimal',
    isDark: true,
    accentName: 'Titanium Pure',
    colors: {
      primary: '#ffffff',
      secondary: '#94a3b8',
      canvas: '#000000',
      surface: '#0a0a0a',
      raised: '#171717',
      border: '#262626',
      text: '#ffffff',
      muted: '#a1a1aa',
    },
  },
];

export function isThemeDark(themeId: ThemeId | string): boolean {
  return themeId !== 'light';
}

export function getTheme(themeId: ThemeId | string): ThemeDefinition {
  return THEMES.find(t => t.id === themeId) || THEMES[0];
}
