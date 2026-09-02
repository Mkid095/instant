<template>
  <div class="container">
    <h1>FIDScript Vue Demo</h1>
    <p class="subtitle">API: https://apiinstant.fidscript.com (FIDScript default)</p>

    <!-- Auth Section -->
    <div class="section">
      <h3>Auth</h3>
      <div v-if="user">
        <p>Signed in as: <strong>{{ user.isGuest ? 'Guest' : user.email }}</strong></p>
        <button @click="handleSignOut">Sign Out</button>
      </div>
      <div v-else>
        <button @click="handleSignIn">Sign In as Guest</button>
      </div>
    </div>

    <!-- Connection Section -->
    <div class="section">
      <h3>Connection</h3>
      <p>Realtime subscriptions active - changes sync across tabs</p>
    </div>

    <!-- Messages -->
    <div class="section">
      <h3>Messages (Realtime)</h3>
      <p v-if="isLoading">Loading...</p>
      <p v-else-if="error" class="error">Error: {{ error.message }}</p>
      <ul v-else>
        <li v-for="msg in data?.messages ?? []" :key="msg.id" class="message-item">
          <span>{{ msg.text }}</span>
          <button @click="handleDelete(msg)" class="delete-btn">×</button>
        </li>
        <li v-if="data?.messages.length === 0" class="empty">No messages yet. Add one below!</li>
      </ul>
    </div>

    <!-- Add Message -->
    <div class="section">
      <h3>Add Message</h3>
      <div class="input-row">
        <input
          v-model="text"
          @keydown.enter="handleSend"
          placeholder="Type a message..."
        />
        <button @click="handleSend" :disabled="!text.trim()">Send</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { id } from '@fidscript/instant-vue';
import { db } from './db';

const { isLoading, error, data } = db.useQuery({ messages: {} });
const { user } = db.useAuth();
const text = ref('');

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
  if (!text.value.trim()) return;
  db.transact(
    db.tx.messages[id()].update({
      text: text.value.trim(),
      createdAt: Date.now(),
    }),
  );
  text.value = '';
};

const handleDelete = (msg: any) => {
  db.transact(db.tx.messages[msg.id].delete());
};
</script>

<style>
.container {
  padding: 20px;
  max-width: 600px;
  margin: 0 auto;
  font-family: system-ui, sans-serif;
}
.subtitle {
  color: #666;
  margin-bottom: 20px;
}
.section {
  margin-bottom: 20px;
  padding: 15px;
  border: 1px solid #ddd;
  border-radius: 8px;
}
h3 {
  margin-top: 0;
}
.message-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid #eee;
  list-style: none;
}
.empty {
  color: #999;
  padding: 8px 0;
}
.delete-btn {
  color: red;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 18px;
}
.input-row {
  display: flex;
  gap: 10px;
}
input {
  flex: 1;
  padding: 8px 12px;
  font-size: 16px;
}
button {
  padding: 8px 16px;
  cursor: pointer;
}
.error {
  color: red;
}
</style>
