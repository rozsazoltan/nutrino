/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,ts}'],
  theme: {
    extend: {
      colors: {
        nutri: {
          50: '#FCFDF7',
          100: '#D4E8D1',
          500: '#33E36A',
          700: '#006E2B',
          800: '#00531F',
          900: '#002108'
        }
      }
    }
  },
  plugins: []
};
