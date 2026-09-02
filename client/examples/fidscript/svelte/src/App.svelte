<script lang="ts">
  import { id } from '@fidscript/instant-svelte';
  import { db } from './db';

  const { isLoading, error, data } = db.useQuery({ messages: {} });
  const { isLoading: authLoading, user } = db.useAuth();

  let text = $state('');

  async function handleSignIn() {
    try {
      await db.auth.signInAsGuest();
    } catch (e) {
      console.error('Sign in error:', e);
    }
  }

  async function handleSignOut() {
    try {
      await db.auth.signOut();
    } catch (e) {
      console.error('Sign out error:', e);
    }
  }

  function handleSend() {
    if (!text.trim()) return;
    db.transact(
      db.tx.messages[id()].update({
        text: text.trim(),
        createdAt: Date.now(),
      }),
    );
    text = '';
  }

  function handleDelete(msg: any) {
    db.transact(db.tx.messages[msg.id].delete());
  }
</script>

<div class="container">
  <h1>FIDScript Svelte Demo</h1>
  <p class="subtitle">API: https://apiinstant.fidscript.com (FIDScript default)</p>

  <div class="section">
    <h3>Auth</h3>
    {#if user}
      <p>Signed in as: <strong>{user.isGuest ? 'Guest' : (user as any).email}</strong></p>
      <button onclick={handleSignOut}>Sign Out</button>
    {:else}
      <button onclick={handleSignIn}>Sign In as Guest</button>
    {/if}
  </div>

  <div class="section">
    <h3>Connection</h3>
    <p>Realtime subscriptions active - changes sync across tabs</p>
  </div>

  <div class="section">
    <h3>Messages (Realtime)</h3>
    {#if isLoading}
      <p>Loading...</p>
    {:else if error}
      <p class="error">Error: {error.message}</p>
    {:else}
      <ul>
        {#each data?.messages ?? [] as msg}
          <li class="message-item">
            <span>{msg.text}</span>
            <button class="delete-btn" onclick={() => handleDelete(msg)}>×</button>
          </li>
        {/each}
        {#if data?.messages.length === 0}
          <li class="empty">No messages yet. Add one below!</li>
        {/if}
      </ul>
    {/if}
  </div>

  <div class="section">
    <h3>Add Message</h3>
    <div class="input-row">
      <input
        type="text"
        bind:value={text}
        onkeydown={(e) => e.key === 'Enter' && handleSend()}
        placeholder="Type a message..."
      />
      <button onclick={handleSend} disabled={!text.trim()}>Send</button>
    </div>
  </div>
</div>

<style>
  .container {
    padding: 20px;
    max-width: 600px;
    margin: 0 auto;
    font-family: system-ui, sans-serif;
  }
  .subtitle { color: #666; margin-bottom: 20px; }
  .section {
    margin-bottom: 20px;
    padding: 15px;
    border: 1px solid #ddd;
    border-radius: 8px;
  }
  h3 { margin-top: 0; }
  .message-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 0;
    border-bottom: 1px solid #eee;
    list-style: none;
  }
  .empty { color: #999; padding: 8px 0; }
  .delete-btn { color: red; border: none; background: none; cursor: pointer; font-size: 18px; }
  .input-row { display: flex; gap: 10px; }
  input { flex: 1; padding: 8px 12px; font-size: 16px; }
  button { padding: 8px 16px; cursor: pointer; }
  .error { color: red; }
</style>
