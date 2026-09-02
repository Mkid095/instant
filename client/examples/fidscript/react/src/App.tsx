/// <reference types="vite/client" />
import { useState } from 'react';
import { id } from '@fidscript/instant-react';
import { db } from './db';
import schema from './schema';
import type { InstaQLEntity } from '@fidscript/instant-react';

type AppSchema = typeof schema;
type Message = InstaQLEntity<AppSchema, 'messages'>;

export default function App() {
  const { isLoading, error, data } = db.useQuery({ messages: {} });
  const { isLoading: authLoading, user } = db.useAuth();
  const [text, setText] = useState('');

  const handleSignIn = async () => {
    try {
      await db.auth.signInAsGuest();
    } catch (e) {
      console.error('Sign in error:', e);
    }
  };

  const handleSignOut = async () => {
    try {
      await db.auth.signOut();
    } catch (e) {
      console.error('Sign out error:', e);
    }
  };

  const handleSend = () => {
    if (!text.trim()) return;
    db.transact(
      db.tx.messages[id()].update({
        text: text.trim(),
        createdAt: Date.now(),
      }),
    );
    setText('');
  };

  const handleDelete = (msg: Message) => {
    db.transact(db.tx.messages[msg.id].delete());
  };

  if (authLoading) return <div className="p-4">Loading...</div>;

  return (
    <div style={{ padding: 20, maxWidth: 600, margin: '0 auto' }}>
      <h1>FIDScript React Demo</h1>
      <p style={{ color: '#666', marginBottom: 20 }}>
        API: https://apiinstant.fidscript.com (FIDScript default)
      </p>

      {/* Auth Section */}
      <div style={{ marginBottom: 20, padding: 15, border: '1px solid #ddd', borderRadius: 8 }}>
        <h3>Auth</h3>
        {user ? (
          <div>
            <p>Signed in as: <strong>{user.isGuest ? 'Guest' : user.email}</strong></p>
            <button onClick={handleSignOut}>Sign Out</button>
          </div>
        ) : (
          <button onClick={handleSignIn}>Sign In as Guest</button>
        )}
      </div>

      {/* Realtime Status */}
      <div style={{ marginBottom: 20, padding: 15, border: '1px solid #ddd', borderRadius: 8 }}>
        <h3>Connection</h3>
        <p>Realtime subscriptions active - changes sync across tabs</p>
      </div>

      {/* Messages */}
      <div style={{ marginBottom: 20, padding: 15, border: '1px solid #ddd', borderRadius: 8 }}>
        <h3>Messages (Realtime)</h3>
        {isLoading ? (
          <p>Loading...</p>
        ) : error ? (
          <p style={{ color: 'red' }}>Error: {error.message}</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {data?.messages.map((msg) => (
              <li key={msg.id} style={{ padding: '8px 0', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{msg.text}</span>
                <button onClick={() => handleDelete(msg)} style={{ color: 'red' }}>×</button>
              </li>
            ))}
            {data?.messages.length === 0 && <li style={{ color: '#999' }}>No messages yet. Add one below!</li>}
          </ul>
        )}
      </div>

      {/* Add Message */}
      <div style={{ padding: 15, border: '1px solid #ddd', borderRadius: 8 }}>
        <h3>Add Message</h3>
        <div style={{ display: 'flex', gap: 10 }}>
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Type a message..."
            style={{ flex: 1, padding: '8px 12px', fontSize: 16 }}
          />
          <button onClick={handleSend} disabled={!text.trim()}>Send</button>
        </div>
      </div>
    </div>
  );
}
