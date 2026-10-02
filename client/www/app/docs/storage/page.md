---
nextjs:
  metadata:
    title: 'Storage'
    description: 'How to upload and serve files with Instant using Cloudinary.'
---

Instant Storage powered by Cloudinary makes it simple to upload and serve files for your app.
You can store images, videos, documents, and any other file type, with direct public URLs returned after every upload.

## How Storage Works

When you upload a file through Instant:

1. **File is uploaded to Cloudinary** - Your file is securely stored in Cloudinary's CDN
2. **You receive a direct public URL** - The response includes a ready-to-use Cloudinary URL
3. **Save the URL to your database** - Store the URL in any string field for later use

This makes integration simple - you get a standard Cloudinary URL that works everywhere and renders fast via CDN.

## Storage Providers

Instant supports multiple storage providers:

| Provider | Use Case | Setup Required |
|----------|----------|----------------|
| **Cloudinary** | Images, videos, any file type | Cloud name, API key, API secret |
| **R2 (Cloudflare)** | S3-compatible, large files | Account ID, access key, bucket |
| **S3** | AWS S3 integration | Bucket, region, credentials |

## Storage Quick Start

Let's build a full example of how to upload and display a grid of images:

```shell {% showCopy=true %}
npx create-next-app instant-storage --tailwind --yes
cd instant-storage
npm i @fidscript/instant-react
```

Initialize your schema and permissions via the [CLI tool](/docs/cli):

```
npx instant-cli@latest init
```

Now open `instant.schema.ts` and replace the contents with the following code.

```javascript {% showCopy=true %}
import { i } from "@fidscript/instant-react";

const _schema = i.schema({
  entities: {
    products: i.entity({
      name: i.string(),
      // Store the Cloudinary URL in a string field
      imageUrl: i.string(),
      videoUrl: i.string().optional(),
    }),
    $files: i.entity({
      path: i.string().unique().indexed(),
      url: i.string(),
    }),
    $users: i.entity({
      email: i.string().unique().indexed(),
    }),
  },
  links: {},
  rooms: {},
});

// This helps TypeScript display nicer IntelliSense
type _AppSchema = typeof _schema;
interface AppSchema extends _AppSchema {}
const schema: AppSchema = _schema;

export type { AppSchema };
export default schema;
```

Similarly, open `instant.perms.ts` and replace the contents with the following:

```javascript {% showCopy=true %}
import type { InstantRules } from "@fidscript/instant-react";

// Not recommended for production since this allows anyone to
// upload/delete, but good for getting started
const rules = {
  "$files": {
    "allow": {
      "view": "true",
      "create": "true",
      "delete": "true"
    }
  }
} satisfies InstantRules;

export default rules;
```

Push up both the schema and permissions to your Instant app with the following command:

```shell {% showCopy=true %}
npx instant-cli@latest push
```

And then replace the contents of `app/page.tsx` with the following code.

```javascript {% showCopy=true %}
'use client';

import { init, InstaQLEntity } from '@fidscript/instant-react';
import schema, { AppSchema } from '../instant.schema';
import React from 'react';

type InstantFile = InstaQLEntity<AppSchema, '$files'>

const APP_ID = process.env.NEXT_PUBLIC_INSTANT_APP_ID;

const db = init({ appId: APP_ID, schema });

// `uploadFile` uploads to Cloudinary and returns a direct URL
async function uploadImage(file: File) {
  try {
    const opts = {
      // See: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Type
      // Default: 'application/octet-stream'
      contentType: file.type,
    };
    // The response includes the Cloudinary URL
    const { data } = await db.storage.uploadFile(file.name, file, opts);
    console.log('Uploaded! Cloudinary URL:', data.url);

    // Save the URL to your database
    await db.transact(
      db.tx.products[data.productId].update({ imageUrl: data.url })
    );
  } catch (error) {
    console.error('Error uploading image:', error);
  }
}

function App() {
  const { isLoading, error, data } = db.useQuery({
    $files: {
      $: {
        order: { serverCreatedAt: 'asc' },
      },
    },
  });

  if (isLoading) {
    return null;
  }

  if (error) {
    return <div>Error fetching data: {error.message}</div>;
  }

  const { $files: images } = data
  return (
    <div className="box-border bg-gray-50 font-mono min-h-screen p-5 flex items-center flex-col">
      <div className="tracking-wider text-5xl text-gray-300 mb-8">
        Image Feed
      </div>
      <ImageUpload />
      <ImageGrid images={images} />
    </div>
  );
}

function ImageUpload() {
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null);
  const [isUploading, setIsUploading] = React.useState(false);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  const handleUpload = async () => {
    if (selectedFile) {
      setIsUploading(true);
      try {
        await db.storage.uploadFile(selectedFile.name, selectedFile);
      } finally {
        setSelectedFile(null);
        setIsUploading(false);
      }
    }
  };

  return (
    <div className="mb-8 p-5 border-2 border-dashed border-gray-300 rounded-lg">
      <input
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        className="font-mono"
      />
      {isUploading ? (
        <div className="mt-5 flex flex-col items-center">
          <div className="w-8 h-8 border-2 border-t-2 border-gray-200 border-t-green-500 rounded-full animate-spin"></div>
          <p className="mt-2 text-sm text-gray-600">Uploading to Cloudinary...</p>
        </div>
      ) : selectedFile && (
        <div className="mt-5 flex flex-col items-center gap-3">
          <img src={URL.createObjectURL(selectedFile)} alt="Preview" className="max-w-xs max-h-xs object-contain" />
          <button onClick={handleUpload} className="py-2 px-4 bg-green-500 text-white border-none rounded-sm cursor-pointer font-mono">
            Upload Image
          </button>
        </div>
      )}
    </div>
  );
}

function ImageGrid({ images }: { images: InstantFile[] }) {
  const handleDelete = async (image: InstantFile) => {
    db.transact(db.tx.$files[image.id].delete());
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5 w-full max-w-6xl">
      {images.map((image) => {
        return (
          <div key={image.id} className="border border-gray-300 rounded-lg overflow-hidden">
            <div className="relative">
              {/* image.url is the direct Cloudinary URL */}
              <img src={image.url} alt={image.path} className="w-full h-64 object-cover" />
            </div>
            <div className="p-3 flex justify-between items-center bg-white">
              <span>{image.path}</span>
              <span onClick={() => handleDelete(image)} className="cursor-pointer text-gray-300 px-1">
                𝘟
              </span>
            </div>
          </div>
        )
      })}
    </div>
  );
}

export default App;
```

With your schema, permissions, and application code set, you can now run your app!

```shell {% showCopy=true %}
npm run dev
```

Go to `localhost:3000`, and you should see a simple image feed where you can
upload and delete images!

## Setting Up Cloudinary

### 1. Create a Cloudinary Account

Sign up at [cloudinary.com](https://cloudinary.com) and copy your:
- **Cloud Name**
- **API Key**
- **API Secret**

### 2. Configure Storage in Your App

#### Via Dashboard
Go to your app settings at `https://instant.fidscript.com` → **Storage** → Enter your Cloudinary credentials.

#### Via MCP/CLI
```bash
update-storage-config \
  --app-id <YOUR_APP_ID> \
  --cloud-name your-cloud-name \
  --api-key your-api-key \
  --api-secret your-api-secret
```

### 3. Create an Upload Preset (Optional)

In Cloudinary dashboard → **Settings** → **Upload** → Create an unsigned upload preset.
Use this for client-side uploads without exposing credentials.

## Upload API Response

When you upload a file, the response includes:

```json
{
  "data": {
    "id": "file-uuid",
    "locationId": "cloudinary-location-id",
    "path": "products/image.jpg",
    "size": 123456,
    "contentType": "image/jpeg",
    "url": "https://res.cloudinary.com/your-cloud/image/upload/v1234567890/products/image.jpg"
  }
}
```

The `url` field contains the **direct Cloudinary URL** you can:
- Store in any string field
- Use directly in `<img src="...">` tags
- Embed in videos with `<video src="...">`
- Share publicly without authentication

## Storage Client SDK

### Upload files

Use `db.storage.uploadFile(path, file, opts?)` to upload a file.

- `path` determines where the file will be stored and can be used with permissions to restrict access to certain files.
- `file` should be a [`File`](https://developer.mozilla.org/en-US/docs/Web/API/File) type, which will likely come from a [file-type input](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/file).
- `opts` can be used to set additional metadata like `contentType` and `contentDisposition`

```javascript
// Use the file's current name as the path
await db.storage.uploadFile(file.name, file);

// Give the file a custom path
const path = `products/${productId}/main-image.jpg`;
await db.storage.uploadFile(path, file);

// Set content type for proper rendering
const path = `documents/invoice-${orderId}.pdf`;
await db.storage.uploadFile(path, file, {
  contentType: 'application/pdf',
});
```

### Upload Response

After successful upload, you'll receive:

```javascript
const { data } = await db.storage.uploadFile(path, file);

console.log(data);
// {
//   id: "file-id",
//   path: "products/image.jpg",
//   url: "https://res.cloudinary.com/cloud/image/upload/v123/products/image.jpg",
//   size: 123456,
//   contentType: "image/jpeg"
// }

// Save URL to your database
await db.transact(
  db.tx.products[productId].update({ imageUrl: data.url })
);
```

### Overwrite files

If the `path` already exists, it will be overwritten!

```javascript
// Uploads to 'demo.png'
await db.storage.uploadFile('demo.png', file);

// Overwrites the file at 'demo.png'
await db.storage.uploadFile('demo.png', file);
```

### View files

Query the `$files` namespace to get files with their URLs:

```javascript
// Fetch all files
const { data } = db.useQuery({
  $files: {
    $: {
      order: { serverCreatedAt: 'asc' },
    },
  },
});

console.log(data.$files[0].url);
// "https://res.cloudinary.com/cloud/image/upload/v123/products/image.jpg"
```

### Delete files

```javascript
// Delete by id
db.transact(db.tx.$files[fileId].delete());

// Delete by path
db.transact(
  db.tx.$files[lookup('path', 'photos/demo.png')].delete()
);
```

## Complete Product Example

Here's how to build a product catalog with images and videos:

### 1. Define Schema

```javascript
const _schema = i.schema({
  entities: {
    products: i.entity({
      name: i.string(),
      description: i.string(),
      price: i.number(),
      imageUrl: i.string(),    // Cloudinary URL for main image
      videoUrl: i.string(),    // Cloudinary URL for product video
    }),
    categories: i.entity({
      name: i.string(),
    }),
  },
  links: {
    productCategory: {
      forward: { on: 'products', has: 'one', label: 'category' },
      reverse: { on: 'categories', has: 'many', label: 'products' },
    },
  },
});
```

### 2. Upload and Save URLs

```javascript
async function createProductWithMedia(formData: FormData) {
  const { name, price, categoryId, image, video } = formData;

  // Upload image to Cloudinary
  const imageResult = await db.storage.uploadFile(
    `products/${name}/main.jpg`,
    image,
    { contentType: image.type }
  );

  // Upload video if provided
  let videoUrl = null;
  if (video) {
    const videoResult = await db.storage.uploadFile(
      `products/${name}/demo.mp4`,
      video,
      { contentType: video.type }
    );
    videoUrl = videoResult.data.url;
  }

  // Create product with URLs stored in database
  await db.transact([
    db.tx.categories[id(categoryId)].link({ products: 'hello' }),
    ['create', 'products', {
      id: randomId(),
      name,
      price,
      imageUrl: imageResult.data.url,
      videoUrl,
    }],
  ]);
}
```

### 3. Render in Your App

```jsx
function ProductCard({ product }) {
  return (
    <div>
      <img src={product.imageUrl} alt={product.name} />
      {product.videoUrl && (
        <video src={product.videoUrl} controls />
      )}
    </div>
  );
}
```

## Using Storage with React Native

`db.storage.uploadFile` expects a `File` or `Blob`.

On Expo SDK 56 and above, `expo/fetch` is the global `fetch` and reads local
files directly, so hand it a `File` from `expo-file-system`:

```typescript
import { File } from 'expo-file-system';

const localFilePath = 'file:///var/mobile/Containers/Data/my_file.m4a';
const file = new File(localFilePath);

await db.storage.uploadFile('my_file.m4a', file, {
  contentType: 'audio/x-m4a',
});
```

On Expo SDK 55 and below (or bare React Native), the built-in `fetch` returns a
native `Blob` you can wrap in a `File`:

```typescript
const localFilePath = 'file:///var/mobile/Containers/Data/my_file.m4a';
const res = await fetch(localFilePath);
const blob = await res.blob();
const file = new File([blob], 'my_file.m4a', { type: 'audio/x-m4a' });

await db.storage.uploadFile('my_file.m4a', file);
```

## Storage Admin SDK

The Admin SDK offers a similar API for managing storage on the server. Permission
checks are not enforced when using the Admin SDK, so you can use it to manage
files without worrying about authentication.

### Uploading files

`db.storage.uploadFile(path, file, opts?)` is also available to upload a file
on the backend. In the Admin SDK, the `file` argument must either be a buffer
or a stream.

```tsx
import fs from 'fs';

const fp = 'path/to/your/file.png';
const dest = 'images/demo.png';

// Upload a file from a buffer
const buffer = fs.readFileSync(filepath);
const { data } = await db.storage.uploadFile(dest, buffer);

// Upload a file from a stream
// IMPORTANT: You must provide `fileSize` as an option when uploading via stream
const stream = fs.createReadStream(fp);
const fileSize = fs.statSync(fp).size;
const { data } = await db.storage.uploadFile(dest, stream, {
  contentType: contentType,
  fileSize,
});
```

### View Files

Retrieving files is similar to the client SDK, but we use `db.query()` instead
of `db.useQuery()`.

```ts
const query = {
  $files: {
    $: {
      order: { serverCreatedAt: 'asc' },
    },
  },
};
const data = db.query(query);
```

### Delete files

```ts
// Delete by id
await db.transact(db.tx.$files[fileId].delete());

// Delete by path
await db.transact(db.tx.$files[lookup('path', 'photos/demo.png')].delete());
```

## R2 / Cloudflare Storage

For R2 storage (S3-compatible), configure:

```bash
update-storage-config \
  --app-id <YOUR_APP_ID> \
  --provider-type r2 \
  --account-id <CLOUDFLARE_ACCOUNT_ID> \
  --access-key-id <R2_ACCESS_KEY_ID> \
  --secret-access-key <R2_SECRET_ACCESS_KEY> \
  --bucket <BUCKET_NAME> \
  --endpoint https://<ACCOUNT_ID>.r2.cloudflarestorage.com
```

R2 URLs are in format: `https://pub.<your-domain.com>/<path>` or use the R2.dev subdomain.

## Permissions

By default, Storage permissions are disabled. This means that until you explicitly set permissions, no uploads or downloads will be possible.

- _create_ permissions enable uploading `$files`
- _view_ permissions enable viewing `$files`
- _update_ permissions enable updating `$files`
- _delete_ permissions enable deleting `$files`
- _view_ permissions on `$files` and _update_ permissions on the forward entity enable linking and unlinking `$files`

In your permissions rules, you can use `auth` to access the currently authenticated user, and `data` to access the file metadata.

At the moment, the only available file metadata is `data.path`, which represents the file's path in Storage. Here are some example permissions:

Allow anyone to upload and retrieve files (easy to play with but not recommended for production):

```json
{
  "$files": {
    "allow": {
      "view": "true",
      "create": "true"
    }
  }
}
```

Allow all authenticated users to view and upload files:

```json
{
  "$files": {
    "allow": {
      "view": "isLoggedIn",
      "create": "isLoggedIn"
    },
    "bind": ["isLoggedIn", "auth.id != null"]
  }
}
```

Authenticated users may only upload, view, and update files from their own subdirectory:

```json
{
  "$files": {
    "allow": {
      "view": "isOwner",
      "update": "isOwner",
      "create": "isOwner"
    },
    "bind": ["isOwner", "data.path.startsWith(auth.id + '/')"]
  }
}
```
