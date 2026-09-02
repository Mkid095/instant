import { init } from '@fidscript/instant-react';
import schema from './schema';

const APP_ID = import.meta.env.VITE_APP_ID || 'demo-app';

export const db = init({
  appId: APP_ID,
  schema,
});
