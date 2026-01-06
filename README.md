# schema-idb

A type-safe IndexedDB layer that brings structure to client-side storage.

```ts
const db = openDB({
  name: "MyApp",
  version: 1,
  stores: [usersStore] as const,
});

await db.users.put({ id: "u1", name: "Kim", email: "kim@example.com" });
const user = await db.users.get("u1");
```

[Live Example](https://stackblitz.com/edit/schema-idb)

---

## What schema-idb provides

IndexedDB is a capable but low-level API. schema-idb adds a thin structure layer:

- **End-to-end type safety** — Schema, queries, and results are all inferred from a single definition.
- **Schema-first design** — Define your data model explicitly. The database follows your schema.
- **Safe schema evolution** — Add fields with defaults. Existing records receive them on read.
- **Predictable queries** — Type-safe, index-backed queries that map directly to IndexedDB capabilities.
- **Zero dependencies** — Small footprint, designed for long-lived applications.

---

## Installation

```bash
npm install schema-idb
```

---

## Quick Start

### 1. Define a store

```ts
import { defineStore, field } from "schema-idb";

const usersStore = defineStore("users", {
  id: field.string().primaryKey(),
  name: field.string().index(),
  email: field.string().index({ unique: true }),
  age: field.number().optional().default(0),
  createdAt: field.date().default(() => new Date()),
});
```

### 2. Open the database

```ts
import { openDB } from "schema-idb";

const db = openDB({
  name: "MyApp",
  version: 1,
  stores: [usersStore] as const,
});
```

### 3. Use it

```ts
// Create or update
await db.users.put({ id: "u1", name: "Kim", email: "kim@example.com" });

// Read
const user = await db.users.get("u1");
console.log(user?.age); // 0 (default applied)

// Query
const adults = await db.users.query({
  index: "age",
  where: { gte: 18 },
  limit: 10,
});

// Delete
await db.users.delete("u1");
```

---

## Schema Definition

### Field types

```ts
field.string(); // string
field.number(); // number
field.boolean(); // boolean
field.date(); // Date
field.string().array(); // string[]
field.object((t) => ({
  // nested object
  street: t.string(),
  city: t.string(),
}));
field.tuple((t) => [t.number(), t.number()]); // [number, number]
field.enum(["active", "inactive"] as const); // union type
```

### Field modifiers

```ts
field
  .string()
  .primaryKey() // set as primary key (exactly one per store)
  .index() // create index for querying
  .index({ unique: true }) // unique index
  .optional() // allow undefined
  .default(value) // default value or factory function
  .array(); // convert to array type
```

### Indexes

Only indexed fields can be queried. Non-indexed fields are stored but not searchable.

```ts
const usersStore = defineStore("users", {
  id: field.string().primaryKey(),
  email: field.string().index(), // ✓ searchable via query()
  bio: field.string(), // ✗ stored, but not searchable
});

// Works
await db.users.query({ index: "email", where: { eq: "kim@example.com" } });

// Error: 'bio' is not an index
await db.users.query({ index: "bio", where: { eq: "..." } });
```

### Complete example

```ts
const usersStore = defineStore("users", {
  id: field.string().primaryKey(),
  email: field.string().index({ unique: true }),
  name: field.string().index(),
  age: field.number().optional().default(0).index(),
  role: field.enum(["admin", "user"] as const).default("user"),
  tags: field.string().array().optional(),
  profile: field
    .object((t) => ({
      bio: t.string().optional(),
      avatar: t.string().optional(),
    }))
    .optional(),
  createdAt: field
    .date()
    .index()
    .default(() => new Date()),
});
```

---

## Querying

schema-idb exposes IndexedDB's single-index model directly, with type safety.

### Object style

```ts
const users = await db.users.query({
  index: "age",
  where: { gte: 18 },
});

const recent = await db.users.query({
  index: "createdAt",
  where: { gte: lastWeek, lte: today },
  orderBy: "desc",
  limit: 20,
});

const kims = await db.users.query({
  index: "name",
  where: { startsWith: "Kim" },
});
```

### Builder style

```ts
const users = await db.users
  .query()
  .index("age")
  .gte(18)
  .orderBy("desc")
  .limit(10)
  .findAll();

const user = await db.users
  .query()
  .index("email")
  .equals("kim@example.com")
  .find();
```

### Where conditions

| Condition    | Description                |
| ------------ | -------------------------- |
| `eq`         | Equals                     |
| `gt` / `gte` | Greater than (or equal)    |
| `lt` / `lte` | Less than (or equal)       |
| `between`    | Inclusive range            |
| `startsWith` | Prefix match (string only) |

---

## Transactions

schema-idb exposes transactions as synchronous write batches across multiple stores.

```ts
const tx = db.startTransaction(["accounts", "logs"]);

// Queue operations (no await between them)
tx.accounts.put({ id: "a1", balance: 900 });
tx.accounts.put({ id: "a2", balance: 1100 });
tx.logs.put({ id: "log1", action: "transfer", amount: 100 });

// Commit all at once
await tx.commit();

// Or abort
tx.abort();
```

Read operations are not available inside transactions. IndexedDB transactions auto-commit after any `await`, so reads must happen outside the transaction.

---

## Migrations

Run code when the database version changes.

```ts
const usersStore = defineStore("users", {
  id: field.string().primaryKey(),
  name: field.string(),
  email: field.string().index({ unique: true }),
})
  .addMigration("001-seed-admin", (db, tx) => {
    tx.objectStore("users").put({
      id: "admin",
      name: "Admin",
      email: "admin@example.com",
    });
  })
  .addMigration("002-normalize-emails", (db, tx) => {
    // Data transformation logic
  });
```

Migrations are identified by name and run in alphabetical order. Applied migrations are tracked and skipped automatically.

---

## Schema Evolution

Add fields without rewriting existing data.

```ts
// Original
const usersStore = defineStore("users", {
  id: field.string().primaryKey(),
  name: field.string(),
});

// Additive change
const usersStore = defineStore("users", {
  id: field.string().primaryKey(),
  name: field.string(),
  role: field.string().optional().default("user"),
});

const user = await db.users.get("existing-id");
console.log(user?.role); // 'user'
```

Defaults are applied on read, keeping migrations cheap and predictable.

---

## Automatic Versioning

Let schema-idb derive versions from your schema.

```ts
const db = openDB({
  name: "MyApp",
  versionStrategy: "auto",
  stores: [usersStore] as const,
});
```

### Auto-applied changes (safe)

- New stores
- New indexes
- Index modifications
- Index deletions

### Requires manual migration (throws error)

- Store deletions (data loss)
- keyPath changes (requires store recreation)

---

## Type Inference

Extract TypeScript types from your schema.

```ts
import type { InferStore } from "schema-idb";

type User = InferStore<typeof usersStore>;
```

---

## API Reference

### Database

```ts
const db = openDB({ name, version, stores });

db.waitForReady(); // Promise<void>
db.ready; // boolean
db.close(); // Close connection
db.version; // Current version number
db.raw; // Underlying IDBDatabase
```

### Store operations

```ts
db.store.get(key); // Get by primary key
db.store.getAll(); // Get all records
db.store.getAllByIndex(index, value); // Get by index value
db.store.put(value); // Insert or update
db.store.add(value); // Insert (fails if exists)
db.store.delete(key); // Delete by key
db.store.clear(); // Delete all
db.store.count(); // Count records
db.store.query(options); // Query with conditions
```

### Utilities

```ts
import { deleteDB, isIndexedDBAvailable } from "schema-idb";

await deleteDB("MyApp");
isIndexedDBAvailable();
```

---

## Limitations

- **Single-index queries** — IndexedDB does not support compound queries.
- **Synchronous write batches** — Transactions cannot include reads (they require `await`).
- **Immutable keyPath** — Changing the primary key requires manual data migration.
- **Browser only** — IndexedDB is not available in Node.js. Use `fake-indexeddb` for testing.

---

## License

MIT
