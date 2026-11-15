import type { Config } from 'tailwindcss';

// Every colour comes from a CSS variable (see globals.css), so light and dark
// themes are a single token swap rather than per-component overrides.
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        bg: token('bg'),
        surface: token('surface'),
        sunken: token('sunken'),
        line: token('line'),
        'line-strong': token('line-strong'),
        ink: token('ink'),
        'ink-2': token('ink-2'),
        'ink-3': token('ink-3'),
        accent: token('accent'),
        'accent-hover': token('accent-hover'),
        'accent-soft': token('accent-soft'),
        'accent-fg': token('accent-fg'),
        ok: token('ok'),
        'ok-soft': token('ok-soft'),
        warn: token('warn'),
        'warn-soft': token('warn-soft'),
        danger: token('danger'),
        'danger-soft': token('danger-soft'),
      },
      fontFamily: {
        sans: ['"Instrument Sans"', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        display: ['Manrope', '"Instrument Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 0 rgb(var(--shadow) / 0.04), 0 1px 3px rgb(var(--shadow) / 0.06)',
        lift: '0 1px 0 rgb(var(--shadow) / 0.04), 0 8px 24px -8px rgb(var(--shadow) / 0.18)',
        sheet: '0 -8px 32px -12px rgb(var(--shadow) / 0.28)',
      },
      keyframes: {
        rise: {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          from: { backgroundPosition: '200% 0' },
          to: { backgroundPosition: '-200% 0' },
        },
      },
      animation: {
        rise: 'rise 260ms cubic-bezier(0.22, 1, 0.36, 1) both',
        shimmer: 'shimmer 1.6s linear infinite',
      },
    },
  },
  plugins: [],
};

export default config;
