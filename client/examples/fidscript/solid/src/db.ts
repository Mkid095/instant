import { init, i } from '@fidscript/instant-solidjs';

const APP_ID = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_APP_ID) || 'demo-app';

const schema = i.schema({
  entities: {
    messages: i.entity({
      text: i.string(),
      createdAt: i.number(),
    }),
  },
});

export const db = init({
  appId: APP_ID,
  schema,
});
