---
nextjs:
  metadata:
    title: 'Getting started with React Native'
    description: 'How to use FIDScript with React Native'
---

You can use FIDScript in React Native projects too! Below is a guide for using FIDScript with Expo.

Open up your terminal and do the following:

```shell {% showCopy=true %}
# Create an app with expo
npx create-expo-app fidscript-rn-demo
cd fidscript-rn-demo

# Install FIDScript
npm i @fidscript/instant-react-native

# Install peer dependencies
npm i @react-native-async-storage/async-storage @react-native-community/netinfo react-native-get-random-values
```

Now open up `app/(tabs)/index.tsx` in your favorite editor and replace the entirety of the file with the following code.

```tsx {% showCopy=true %}
import { init, i, InstaQLEntity } from '@fidscript/instant-react-native';
import { View, Text, Button, StyleSheet } from 'react-native';

// FIDScript app
const APP_ID = '__APP_ID__';

// Optional: You can declare a schema!
const schema = i.schema({
  entities: {
    colors: i.entity({
      value: i.string(),
    }),
  },
});

type Color = InstaQLEntity<typeof schema, 'colors'>;

const db = init({ appId: APP_ID, schema });

const selectId = '4d39508b-9ee2-48a3-b70d-8192d9c5a059';

function App() {
  const { isLoading, error, data } = db.useQuery({
    colors: {
      $: { where: { id: selectId } },
    },
  });
  if (isLoading) {
    return (
      <View>
        <Text>Loading...</Text>
      </View>
    );
  }
  if (error) {
    return (
      <View>
        <Text>Error: {error.message}</Text>
      </View>
    );
  }

  return <Main color={data.colors[0]} />;
}

function Main(props: { color?: Color }) {
  const { value } = props.color || { value: 'lightgray' };

  return (
    <View style={[styles.container, { backgroundColor: value }]}>
      <View style={[styles.contentSection]}>
        <Text style={styles.header}>Hi! pick your favorite color</Text>
        <View style={styles.spaceX4}>
          {['green', 'blue', 'purple'].map((c) => {
            return (
              <Button
                title={c}
                onPress={() => {
                  db.transact(db.tx.colors[selectId].update({ value: c }));
                }}
                key={c}
              />
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  spaceY4: {
    marginVertical: 16,
  },
  spaceX4: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginHorizontal: 16,
  },
  contentSection: {
    backgroundColor: 'white',
    opacity: 0.8,
    padding: 12,
    borderRadius: 8,
  },
  header: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 16,
  },
});

export default App;
```

If you haven't already, install the Expo Go app on iOS or Android. Once you have that installed, you can run the app from your terminal.

```
npm run start
```

Scan the QR code with your phone and follow the instructions on the screen :)

Huzzah 🎉 You've got your first React Native FIDScript app running! Check out the [Working with data](/docs/init) section to learn more about FIDScript concepts!

## Implementing your own store

You can implement a custom local cache by extending `StoreInterface` from `@fidscript/instant-react-native`. Here's an example in-memory store:

```tsx {% showCopy=true %}
import {
  StoreInterface,
  StoreInterfaceStoreName,
} from '@fidscript/instant-react-native';

class InMemoryStore extends StoreInterface {
  _map: Map<string, any>;

  constructor(appId: string, storeName: StoreInterfaceStoreName) {
    super(appId, storeName);
    this._map = new Map();
  }

  async getItem(key: string): Promise<any> {
    return this._map.get(key) ?? null;
  }

  async multiSet(keyValuePairs: Array<[string, any]>): Promise<void> {
    for (const [key, value] of keyValuePairs) {
      this._map.set(key, value);
    }
  }

  async removeItem(key: string): Promise<void> {
    this._map.delete(key);
  }

  async getAllKeys(): Promise<string[]> {
    return Array.from(this._map.keys());
  }
}
```

Then pass your custom store class to `init`:

```tsx {% showCopy=true %}
import { init } from '@fidscript/instant-react-native';

const db = init({
  appId: APP_ID,
  Store: InMemoryStore,
});
```

## Next Steps

For more advanced features, check out [Working with data](/docs/init) to learn more about FIDScript concepts.

As you get more familiar with FIDScript, check out our [Recommended Workflow](/docs/workflow) docs.
