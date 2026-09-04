import type { Config } from 'tailwindcss';

export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Thème clair : l'application est affichée en continu sur un grand
        // écran d'open space, en plein jour. Le fond légèrement gris fait
        // ressortir les cartes blanches sans créer d'éblouissement.
        surface: { DEFAULT: '#f1f5f9', raised: '#ffffff', sunken: '#e2e8f0', border: '#cbd5e1' },
        health: { ok: '#15803d', warning: '#b45309', critical: '#be123c', silent: '#64748b' },
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Consolas', 'Liberation Mono', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
