import type { ClipsDocument } from './clipTypes';

export const defaultClipsData: ClipsDocument = {
  title: 'App Launch Video',
  hook: 'Turn ideas into deployable apps instantly.',
  summary: 'App launch demo video.',
  closing: 'Build and ship today.',
  hue: 220,
  chapters: [
    {
      title: 'Overview',
      summary: 'Product demo.',
      startClip: 0,
      clipCount: 1,
    },
  ],
  clips: [
    {
      background: 'blur',
      speech: 'Turn ideas into deployable apps instantly.',
      items: [
        {
          type: 'text-typing',
          title: 'Launch Fast',
          duration: 2.0,
        },
      ],
    },
  ],
};
