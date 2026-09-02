/// <reference types="vite/client" />
import { init, i } from '@fidscript/instant-vue';

const APP_ID = import.meta.env.VITE_APP_ID || 'demo-app';

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
