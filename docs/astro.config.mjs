// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import remarkLean from 'remark-lean';
import { fileURLToPath } from 'node:url';

// https://astro.build/config
export default defineConfig({
  site: 'https://mzhang28.github.io',
  base: '/remark-lean',
  markdown: {
    remarkPlugins: [
      [remarkLean, { rootUri: fileURLToPath(new URL('../examples/basic/lean', import.meta.url)) }]
    ]
  },
  integrations: [
    starlight({
      title: 'My Docs',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/mzhang28/remark-lean' }],
      sidebar: [
        { label: 'Roadmap', slug: 'roadmap' },
        {
          label: 'STLC',
          items: [
            { label: 'Introduction', slug: 'stlc/introduction' },
          ],
        },
      ],
      customCss: [
        'remark-lean/lean.css',
        './src/styles/custom.css'
      ],
      components: {
        Head: './src/components/Head.astro',
      }
    }),
  ],
});
