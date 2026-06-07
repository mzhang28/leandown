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
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/withastro/starlight' }],
      sidebar: [
        {
          label: 'Guides',
          items: [
            { label: 'Example Guide', slug: 'guides/example' },
            { label: 'Lean Integration', slug: 'guides/lean' },
            { label: 'Roadmap & Features', slug: 'guides/roadmap' },
          ],
        },
        {
          label: 'Reference',
          items: [{ autogenerate: { directory: 'reference' } }],
        },
      ],
      customCss: [
        'remark-lean/lean.css'
      ],
      components: {
        Head: './src/components/Head.astro',
      }
    }),
  ],
});
