const { hairlineWidth } = require('nativewind/theme');

/**
 * Tailwind (NativeWind) configuration — the "Cathode" design system.
 *
 * Colors are CSS variables defined in `global.css` so light and dark share one
 * set of class names. Beyond the shadcn tokens the app adds what the game needs:
 * success/warning feedback, XP and streak accents, the code surface with its
 * gutter, the ledge colours under every pressable slab, and per-course accents.
 *
 * React Native does not synthesize font weights, so each weight is its own
 * family (`font-sans`, `font-strong`, `font-display`, `font-mono`,
 * `font-mono-strong`, `font-num`) rather than a `font-bold` utility.
 *
 * @type {import('tailwindcss').Config}
 */
module.exports = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
          ledge: 'hsl(var(--ledge-primary))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
          ledge: 'hsl(var(--ledge-secondary))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
          ledge: 'hsl(var(--ledge-destructive))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
          ledge: 'hsl(var(--ledge-card))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
          ledge: 'hsl(var(--ledge-success))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
        },
        xp: {
          DEFAULT: 'hsl(var(--xp))',
          foreground: 'hsl(var(--xp-foreground))',
        },
        streak: {
          DEFAULT: 'hsl(var(--streak))',
          foreground: 'hsl(var(--streak-foreground))',
        },
        code: {
          DEFAULT: 'hsl(var(--code-bg))',
          border: 'hsl(var(--code-border))',
          foreground: 'hsl(var(--code-foreground))',
          gutter: 'hsl(var(--code-gutter))',
        },
        surface: {
          DEFAULT: 'hsl(var(--background))',
          2: 'hsl(var(--surface-2))',
        },
        course: {
          python: 'hsl(var(--course-python))',
          javascript: 'hsl(var(--course-javascript))',
        },
        chart: {
          1: 'hsl(var(--chart-1))',
          2: 'hsl(var(--chart-2))',
          3: 'hsl(var(--chart-3))',
          4: 'hsl(var(--chart-4))',
          5: 'hsl(var(--chart-5))',
        },
      },
      // React Native does not synthesize weights: every weight is its own family.
      // None of these keys collide with Tailwind's own fontWeight utilities
      // (font-medium / font-semibold / font-bold / font-extrabold), which would
      // otherwise win the cascade and emit a weight with no family.
      fontFamily: {
        sans: ['Inter_500Medium'],
        strong: ['Inter_700Bold'],
        display: ['Inter_800ExtraBold'],
        mono: ['JetBrainsMono_500Medium'],
        'mono-strong': ['JetBrainsMono_700Bold'],
        num: ['JetBrainsMono_800ExtraBold'],
      },
      // --radius: 1rem => sm 8 / md 12 / lg 16 / xl 22 / 2xl 28 / 3xl 32.
      borderRadius: {
        sm: 'calc(var(--radius) - 8px)',
        md: 'calc(var(--radius) - 4px)',
        lg: 'var(--radius)',
        xl: 'calc(var(--radius) + 6px)',
        '2xl': 'calc(var(--radius) + 12px)',
        '3xl': 'calc(var(--radius) + 16px)',
      },
      borderWidth: {
        hairline: hairlineWidth(),
        3: '3px',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'pop-in': {
          '0%': { opacity: '0', transform: 'scale(0.88)' },
          '70%': { opacity: '1', transform: 'scale(1.04)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        shake: {
          '0%, 100%': { transform: 'translateX(0px)' },
          '20%': { transform: 'translateX(-6px)' },
          '40%': { transform: 'translateX(6px)' },
          '60%': { transform: 'translateX(-6px)' },
          '80%': { transform: 'translateX(6px)' },
        },
        'pulse-glow': {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.72', transform: 'scale(1.06)' },
        },
        'xp-fill': {
          '0%': { transform: 'scaleX(0)' },
          '100%': { transform: 'scaleX(1)' },
        },
        celebrate: {
          '0%': { opacity: '0', transform: 'scale(0.92)' },
          '55%': { opacity: '1', transform: 'scale(1.04)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'caret-blink': {
          '0%, 49%': { opacity: '1' },
          '50%, 100%': { opacity: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'pop-in': 'pop-in 260ms cubic-bezier(0.16, 1, 0.3, 1)',
        shake: 'shake 240ms cubic-bezier(0.2, 0, 0, 1)',
        'pulse-glow': 'pulse-glow 1800ms cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'xp-fill': 'xp-fill 700ms cubic-bezier(0.22, 1, 0.36, 1) forwards',
        celebrate: 'celebrate 320ms cubic-bezier(0.16, 1, 0.3, 1)',
        'caret-blink': 'caret-blink 1000ms steps(1, end) infinite',
      },
    },
  },
  future: {
    hoverOnlyWhenSupported: true,
  },
  plugins: [require('tailwindcss-animate')],
};
