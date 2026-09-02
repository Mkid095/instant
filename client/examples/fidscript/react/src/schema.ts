import { i } from '@fidscript/instant-react';

export default i.schema({
  entities: {
    messages: i.entity({
      text: i.string(),
      createdAt: i.number(),
    }),
  },
});
