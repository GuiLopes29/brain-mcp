/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'brain-bg': '#050A14',
        'brain-surface': '#0D1B2A',
        'brain-cyan': '#00F5FF',
        'brain-purple': '#7B2FBE',
        'brain-red': '#FF3366',
        'brain-text': '#E0E8F0',
      },
      fontFamily: {
        display: ['Orbitron', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
