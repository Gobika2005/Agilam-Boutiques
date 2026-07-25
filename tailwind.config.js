/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Manrope', 'system-ui', 'sans-serif'],
        serif: ['"Cormorant Garamond"', 'serif'],
        script: ['"Dancing Script"', 'cursive'],
      },
      colors: {
        rose: {
          bg: '#F6E9EF',
          card: '#FDEEF4',
          border: '#F0D8E2',
          borderSoft: '#F5E4EC',
          borderMid: '#F3DFE8',
          text: '#2A1A20',
          muted: '#8A7078',
          mutedSoft: '#B79AA6',
          label: '#6B5560',
          fieldLabel: '#7A5C67',
          primary: '#D6336C',
          primaryDark: '#B02454',
          deep: '#8E1C44',
          chip: '#FCE0EC',
          chipAlt: '#FBEDF3',
          danger: '#D6455A',
          dangerBorder: '#E7A7B4',
        },
        gold: { DEFAULT: '#C99A3F', dark: '#9E7524', text: '#8A6420', soft: '#F4D9A6' },
        good: { DEFAULT: '#2FA36B', bg: '#E5F3EC', text: '#218456' },
        warn: { bg: '#FBF0DA', text: '#B8860B' },
        bad: { bg: '#FBE3E3', text: '#C0392B' },
        info: { bg: '#E6F0FA', text: '#3A6EA5' },
      },
      boxShadow: {
        soft: '0 12px 28px -22px rgba(107,20,54,.6)',
        card: '0 10px 26px -22px rgba(107,20,54,.6)',
        raised: '0 6px 18px -12px rgba(107,20,54,.6)',
        button: '0 14px 30px -14px rgba(214,51,108,.8)',
        phone: '0 40px 90px -30px rgba(107,20,54,.55), inset 0 0 0 2px #2c1f26',
        panel: '0 30px 80px -44px rgba(107,20,54,.5)',
      },
      keyframes: {
        fade: { from: { opacity: 0 }, to: { opacity: 1 } },
        sheet: { from: { transform: 'translateY(100%)' }, to: { transform: 'translateY(0)' } },
      },
      animation: {
        fade: 'fade .2s ease',
        sheet: 'sheet .28s cubic-bezier(.2,.9,.3,1)',
      },
    },
  },
  plugins: [],
};
