const config = {
  darkMode: 'class',
  content: [
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        obsidian: {
          950: '#050507',
          900: '#0B0C10',
          800: '#12141C',
        },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      backgroundImage: {
        'obsidian-spotlight':
          'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(99, 102, 241, 0.14), rgba(16, 185, 129, 0.04), transparent)',
        'dot-matrix':
          'radial-gradient(rgba(255, 255, 255, 0.06) 1px, transparent 1px)',
      },
    },
  },
  plugins: [],
};

export default config;
