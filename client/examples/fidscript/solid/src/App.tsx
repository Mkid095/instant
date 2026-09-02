import { createSignal } from 'solid-js';
import { id } from '@fidscript/instant-solidjs';
import { db } from './db';

export default function App() {
  const { isLoading, error, data } = db.useQuery({ messages: {} });
  const { isLoading: authLoading, user } = db.useAuth();
  const [text, setText] = createSignal('');

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
    if (!text().trim()) return;
    db.transact(
      db.tx.messages[id()].update({
        text: text().trim(),
        createdAt: Date.now(),
      }),
    );
    setText('');
  };

  const handleDelete = (msg: any) => {
    db.transact(db.tx.messages[msg.id].delete());
  };

  return (
    <div style={{ padding: '20px', 'max-width': '600px', margin: '0 auto', 'font-family': 'system-ui, sans-serif' }}>
      <h1>FIDScript Solid Demo</h1>
      <p style={{ color: '#666', 'margin-bottom': '20px' }}>
        API: https://apiinstant.fidscript.com (FIDScript default)
      </p>

      <div style={{ 'margin-bottom': '20px', padding: '15px', border: '1px solid #ddd', 'border-radius': '8px' }}>
        <h3>Auth</h3>
        {user() ? (
          <div>
            <p>Signed in as: <strong>{user()?.isGuest ? 'Guest' : user()?.email}</strong></p>
            <button onClick={handleSignOut}>Sign Out</button>
          </div>
        ) : (
          <button onClick={handleSignIn}>Sign In as Guest</button>
        )}
      </div>

      <div style={{ 'margin-bottom': '20px', padding: '15px', border: '1px solid #ddd', 'border-radius': '8px' }}>
        <h3>Connection</h3>
        <p>Realtime subscriptions active - changes sync across tabs</p>
      </div>

      <div style={{ 'margin-bottom': '20px', padding: '15px', border: '1px solid #ddd', 'border-radius': '8px' }}>
        <h3>Messages (Realtime)</h3>
        {isLoading() ? (
          <p>Loading...</p>
        ) : error() ? (
          <p style={{ color: 'red' }}>Error: {error()?.message}</p>
        ) : (
          <ul style={{ 'list-style': 'none', padding: '0' }}>
            {data()?.messages.map((msg) => (
              <li key={msg.id} style={{ padding: '8px 0', 'border-bottom': '1px solid #eee', display: 'flex', 'justify-content': 'space-between', 'align-items': 'center' }}>
                <span>{msg.text}</span>
                <button onClick={() => handleDelete(msg)} style={{ color: 'red' }}>×</button>
              </li>
            ))}
            {data()?.messages.length === 0 && <li style={{ color: '#999' }}>No messages yet. Add one below!</li>}
          </ul>
        )}
      </div>

      <div style={{ padding: '15px', border: '1px solid #ddd', 'border-radius': '8px' }}>
        <h3>Add Message</h3>
        <div style={{ display: 'flex', gap: '10px' }}>
          <input
            type="text"
            value={text()}
            onInput={(e) => setText(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Type a message..."
            style={{ flex: '1', padding: '8px 12px', 'font-size': '16px' }}
          />
          <button onClick={handleSend} disabled={!text().trim()}>Send</button>
        </div>
      </div>
    </div>
  );
}
