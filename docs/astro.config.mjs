// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import remarkLean from '@leandown/remark';
import { fileURLToPath } from 'node:url';

// https://astro.build/config
export default defineConfig({
  site: 'https://mzhang28.github.io',
  base: '/leandown',
  markdown: {
    remarkPlugins: [
      [remarkLean, { leanProjectPath: fileURLToPath(new URL('../examples/basic/lean', import.meta.url)) }]
    ]
  },
  integrations: [
    starlight({
      title: 'leandown',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/mzhang28/leandown' }],
      sidebar: [
        { label: 'Overview',
          items: [
        { label: 'Intro', slug: 'overview/intro' },
        { label: 'Roadmap', slug: 'overview/roadmap' },
          ],
        },
        {
          label: 'Examples',
          items: [
            { label: 'Basic', slug: 'basic' },
            { label: 'STLC', slug: 'stlc' },
          ],
        },
      ],
      customCss: [
        '@leandown/core/lean.css',
        './src/styles/custom.css'
      ],
      components: {
        Head: './src/components/Head.astro',
      }
    }),
  ],
  server: {
    allowedHosts: ["ephemeral"]
  },
});
