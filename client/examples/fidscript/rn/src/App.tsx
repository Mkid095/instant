import 'react-native-get-random-values';
import { init, i, InstaQLEntity } from '@fidscript/instant-react-native';
import { View, Text, TextInput, Button, StyleSheet, FlatList } from 'react-native';

const APP_ID = 'demo-app';

const schema = i.schema({
  entities: {
    messages: i.entity({
      text: i.string(),
      createdAt: i.number(),
    }),
  },
});

type Message = InstaQLEntity<typeof schema, 'messages'>;

const db = init({ appId: APP_ID, schema });

export default function App() {
  const { isLoading, error, data } = db.useQuery({ messages: {} });
  const { isLoading: authLoading, user } = db.useAuth();
  const [text, setText] = React.useState('');

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

  const { id } = { id: () => Math.random().toString(36).slice(2) };

  if (authLoading) return <View style={styles.container}><Text>Loading...</Text></View>;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>FIDScript React Native Demo</Text>
      <Text style={styles.subtitle}>API: https://apiinstant.fidscript.com</Text>

      {/* Auth */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Auth</Text>
        {user ? (
          <View>
            <Text>Signed in as: {user.isGuest ? 'Guest' : user.email}</Text>
            <Button title="Sign Out" onPress={handleSignOut} />
          </View>
        ) : (
          <Button title="Sign In as Guest" onPress={handleSignIn} />
        )}
      </View>

      {/* Messages */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Messages (Realtime)</Text>
        {isLoading ? (
          <Text>Loading...</Text>
        ) : error ? (
          <Text style={styles.error}>Error: {error.message}</Text>
        ) : (
          <FlatList
            data={data?.messages ?? []}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <View style={styles.messageItem}>
                <Text style={styles.messageText}>{item.text}</Text>
                <Button title="×" onPress={() => handleDelete(item)} color="red" />
              </View>
            )}
            ListEmptyComponent={<Text style={styles.empty}>No messages yet</Text>}
          />
        )}
      </View>

      {/* Add Message */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Add Message</Text>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="Type a message..."
            onSubmitEditing={handleSend}
          />
          <Button title="Send" onPress={handleSend} disabled={!text.trim()} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, paddingTop: 60, backgroundColor: '#fff' },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 5 },
  subtitle: { color: '#666', marginBottom: 20 },
  section: { marginBottom: 20, padding: 15, borderWidth: 1, borderColor: '#ddd', borderRadius: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '600', marginBottom: 10 },
  error: { color: 'red' },
  messageItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#eee' },
  messageText: { flex: 1 },
  empty: { color: '#999', textAlign: 'center', padding: 20 },
  inputRow: { flexDirection: 'row', gap: 10 },
  input: { flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 10 },
});

import React from 'react';
