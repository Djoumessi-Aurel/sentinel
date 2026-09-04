import type { Config } from 'tailwindcss';

export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Palette de l'interface. Les couleurs des *logs*, elles, ne viennent
        // jamais d'ici : elles sont lues dans AppConfig.displayColors
        // (docs/CLAUDE.md §8).
        surface: { DEFAULT: '#0f172a', raised: '#1e293b', border: '#334155' },
        health: { ok: '#22c55e', warning: '#fbbf24', critical: '#ef4444', silent: '#94a3b8' },
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Consolas', 'Liberation Mono', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
