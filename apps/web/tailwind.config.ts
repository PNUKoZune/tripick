import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#FF6B35',
          light: '#FF9A6C',
          dark: '#E54E1A',
        },
      },
    },
  },
  plugins: [],
};

export default config;
