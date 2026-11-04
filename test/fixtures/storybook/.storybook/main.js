export default {
  stories: ['../src/**/*.mdx', '../src/**/*.stories.@(js|jsx)'],
  framework: '@storybook/react-vite',
  addons: ['@storybook/addon-docs', { name: 'storybook-pdf-export', options: { pdfUrl: 'storybook.pdf' } }],
};
