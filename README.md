# schema-idb

A type-safe IndexedDB layer that brings structure to client-side storage.

[Live Example](https://stackblitz.com/edit/schema-idb)

```ts
const db = openDB({
  name: "MyApp",
  versionStrategy: "auto",
  stores: [usersStore] as const,
});

await db.users.put({ id: "u1", name: "Kim", email: "kim@example.com" });
const user = await db.users.get("u1");
```

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
  versionStrategy: "auto",
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
// Single store
const tx = db.startTransaction("accounts");

// Multiple stores
const tx = db.startTransaction(["accounts", "logs"]);

// Queue operations (no await between them)
tx.accounts.put({ id: "a1", balance: 900 });
tx.accounts.put({ id: "a2", balance: 1100 });
tx.logs.put({ id: "log1", action: "transfer", amount: 100 });

// Commit all at once
await tx.commit();

// Or abort
tx.abort();

// Access underlying IDBTransaction if needed
tx.raw;
```

Read operations are not available inside transactions. IndexedDB transactions auto-commit after any `await`, so schema-idb only supports synchronous write batching.

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

### Requires manual migration (throws error by default)

- Store deletions (data loss)
- keyPath changes (requires store recreation)

### Handling removed stores

When a store is removed from the schema, you can choose how to handle it:

```ts
const db = openDB({
  name: "MyApp",
  versionStrategy: "auto",
  // 'error' (default): Throws an error when stores are removed
  // 'preserve': Renames removed stores to __storeName_deleted_v{version}__ as backup.
  //             Preserved stores are isolated from the typed API to avoid future name collisions.
  removedStoreStrategy: "preserve",
  stores: [usersStore] as const,
});
```

#### Behavior with explicit versioning

When `versionStrategy` is `"explicit"`:

- Schema changes are **detected** but **NOT applied** automatically
- `removedStoreStrategy` is evaluated for preview purposes only
- A warning is logged if schema changes are detected but version is not bumped

```
[schema-idb] Schema changes detected but version not bumped:
- Rename store "oldStore" to "__oldStore_deleted_v2__"
Current DB version: 1, Provided version: 1
Bump the version to apply these changes.
```

**Important:** `removedStoreStrategy` does not perform migrations in explicit mode. It only describes what _would_ happen after a version bump. To apply the changes, increment the `version` number.

To explicitly delete a store (including backups), use a migration:

```ts
const usersStore = defineStore("users", {
  // ...
}).addMigration("003-delete-old-store", (db) => {
  db.deleteObjectStore("oldStore");
  db.deleteObjectStore("__oldStore_deleted_v2__"); // Remove backup too
});
```

---

## Type Inference

Extract TypeScript types from your schema.

```ts
import type { InferStore } from "schema-idb";

type User = InferStore<typeof usersStore>;
```

---

## API Reference

> This section is intended as a complete, authoritative reference.
> Most users will not need to read it top-to-bottom.
> For a guided introduction and examples, see the sections above.

### openDB

Opens a database connection with the given configuration.

```ts
function openDB<T extends readonly SchemaStoreDefinition[]>(options: {
  name: string;
  stores: T;
  versionStrategy?: "auto" | "explicit";
  version?: number;
  removedStoreStrategy?: "error" | "preserve";
}): SchemaDatabase<T>;
```

| Option | Type | Description |
| ------ | ---- | ----------- |
| `name` | `string` | Database name |
| `stores` | `readonly SchemaStoreDefinition[]` | Store definitions created with `defineStore` |
| `versionStrategy` | `"auto" \| "explicit"` | `"auto"` detects schema changes automatically. Default: `"explicit"` (recommended for production control) |
| `version` | `number` | Required when `versionStrategy` is `"explicit"` |
| `removedStoreStrategy` | `"error" \| "preserve"` | How to handle removed stores. Default: `"error"` |

### SchemaDatabase

The database object returned by `openDB`.

| Property | Type | Description |
| -------- | ---- | ----------- |
| `name` | `string` | Database name |
| `version` | `number` | Current schema version |
| `ready` | `boolean` | Whether the database is ready |
| `raw` | `IDBDatabase` | Underlying IndexedDB instance |
| `[storeName]` | `StoreAccessor` | Direct access to stores (e.g., `db.users`) |

| Method | Signature | Description |
| ------ | --------- | ----------- |
| `waitForReady` | `() => Promise<void>` | Wait for database initialization |
| `close` | `() => void` | Close the database connection |
| `startTransaction` | `(stores, options?) => Transaction` | Start a multi-store transaction |

### Store Accessor

Each store is accessible as a property on the database object (e.g., `db.users`).

#### get

```ts
get(key: K): Promise<T | undefined>
```

| Param | Type | Description |
| ----- | ---- | ----------- |
| `key` | `K` | Primary key value |

Returns the record matching the key, or `undefined` if not found.

#### getAll

```ts
getAll(): Promise<T[]>
```

Returns all records in the store.

#### getBy

```ts
getBy<I extends IndexedFields>(indexName: I, query: V | IDBKeyRange): Promise<T | undefined>
```

| Param | Type | Description |
| ----- | ---- | ----------- |
| `indexName` | `I` | Name of the index to query |
| `query` | `V \| IDBKeyRange` | Value to match or key range |

Returns the first record matching the index value.

#### getAllBy

```ts
getAllBy<I extends IndexedFields>(indexName: I, query?: V | IDBKeyRange): Promise<T[]>
```

| Param | Type | Description |
| ----- | ---- | ----------- |
| `indexName` | `I` | Name of the index to query |
| `query` | `V \| IDBKeyRange` | Value to match or key range (optional) |

Returns all records matching the index value. If `query` is omitted, returns all records ordered by the index.

#### put

```ts
put(value: T, key?: K): Promise<K>
```

| Param | Type | Description |
| ----- | ---- | ----------- |
| `value` | `T` | Record to insert or update |
| `key` | `K` | Optional key (only needed if store has no keyPath) |

Inserts a new record or updates an existing one. Returns the primary key.

#### add

```ts
add(value: T, key?: K): Promise<K>
```

| Param | Type | Description |
| ----- | ---- | ----------- |
| `value` | `T` | Record to insert |
| `key` | `K` | Optional key (only needed if store has no keyPath) |

Inserts a new record. Throws an error if the key already exists.

#### delete

```ts
delete(key: K | IDBKeyRange): Promise<void>
```

| Param | Type | Description |
| ----- | ---- | ----------- |
| `key` | `K \| IDBKeyRange` | Primary key or key range to delete |

Deletes record(s) matching the key or range.

#### clear

```ts
clear(): Promise<void>
```

Deletes all records in the store.

#### count

```ts
count(query?: IDBKeyRange | IDBValidKey): Promise<number>
```

| Param | Type | Description |
| ----- | ---- | ----------- |
| `query` | `IDBKeyRange \| IDBValidKey` | Optional key or range to count |

Returns the number of records. If `query` is provided, counts only matching records.

#### query

```ts
query(options: QueryOptions): Promise<T[]>
query(): QueryBuilder
```

| Param | Type | Description |
| ----- | ---- | ----------- |
| `options` | `QueryOptions` | Query configuration (optional) |

When called with options, executes the query and returns results. When called without arguments, returns a `QueryBuilder` for chaining.

### Query Options

Used with `db.store.query(options)`.

```ts
interface QueryOptions {
  index: string;
  where?: WhereCondition;
  orderBy?: "asc" | "desc";
  limit?: number;
  offset?: number;
}
```

| Option | Type | Description |
| ------ | ---- | ----------- |
| `index` | `string` | Index name to query on |
| `where` | `WhereCondition` | Filter conditions (optional) |
| `orderBy` | `"asc" \| "desc"` | Sort order. Default: `"asc"` |
| `limit` | `number` | Maximum number of results (optional) |
| `offset` | `number` | Number of results to skip. Default: `0` |

#### WhereCondition

```ts
interface WhereCondition {
  eq?: T;
  gt?: T;
  gte?: T;
  lt?: T;
  lte?: T;
  between?: [T, T];
  startsWith?: string;
}
```

| Option | Type | Description |
| ------ | ---- | ----------- |
| `eq` | `T` | Exact match |
| `gt` | `T` | Greater than |
| `gte` | `T` | Greater than or equal |
| `lt` | `T` | Less than |
| `lte` | `T` | Less than or equal |
| `between` | `[T, T]` | Inclusive range `[lower, upper]` |
| `startsWith` | `string` | Prefix match (string indexes only) |

### Query Builder

Returned when calling `db.store.query()` without arguments.

#### index

```ts
index<I extends IndexedFields>(name: I): IndexQueryBuilder
```

| Param | Type | Description |
| ----- | ---- | ----------- |
| `name` | `I` | Index name to query on |

Returns an `IndexQueryBuilder` for the specified index.

#### key

```ts
key(): IndexQueryBuilder
```

Returns an `IndexQueryBuilder` that queries by primary key.

#### findAll

```ts
findAll(): Promise<T[]>
```

Executes the query and returns all matching records.

### IndexQueryBuilder

Provides condition methods for filtering. All methods return a `FinalQueryBuilder`.

#### equals

```ts
equals(value: V): FinalQueryBuilder
```

| Param | Type | Description |
| ----- | ---- | ----------- |
| `value` | `V` | Value to match exactly |

#### gt / gte / lt / lte

```ts
gt(value: V): FinalQueryBuilder   // Greater than
gte(value: V): FinalQueryBuilder  // Greater than or equal
lt(value: V): FinalQueryBuilder   // Less than
lte(value: V): FinalQueryBuilder  // Less than or equal
```

| Param | Type | Description |
| ----- | ---- | ----------- |
| `value` | `V` | Boundary value for comparison |

#### between

```ts
between(lower: V, upper: V): FinalQueryBuilder
```

| Param | Type | Description |
| ----- | ---- | ----------- |
| `lower` | `V` | Lower bound (inclusive) |
| `upper` | `V` | Upper bound (inclusive) |

#### startsWith

```ts
startsWith(prefix: string): FinalQueryBuilder
```

| Param | Type | Description |
| ----- | ---- | ----------- |
| `prefix` | `string` | Prefix to match |

Only available for string indexes.

### FinalQueryBuilder

Provides result modifiers and execution methods.

#### orderBy

```ts
orderBy(order: "asc" | "desc"): FinalQueryBuilder
```

| Param | Type | Description |
| ----- | ---- | ----------- |
| `order` | `"asc" \| "desc"` | Sort direction |

#### limit

```ts
limit(count: number): FinalQueryBuilder
```

| Param | Type | Description |
| ----- | ---- | ----------- |
| `count` | `number` | Maximum number of results |

#### offset

```ts
offset(count: number): FinalQueryBuilder
```

| Param | Type | Description |
| ----- | ---- | ----------- |
| `count` | `number` | Number of results to skip |

#### findAll

```ts
findAll(): Promise<T[]>
```

Executes the query and returns all matching records.

#### find

```ts
find(): Promise<T | undefined>
```

Executes the query and returns the first matching record, or `undefined` if none found.

#### count

```ts
count(): Promise<number>
```

Returns the number of matching records without fetching them.

### Transaction

#### startTransaction

```ts
startTransaction(
  stores: string | string[],
  options?: TransactionOptions
): Transaction
```

| Param | Type | Description |
| ----- | ---- | ----------- |
| `stores` | `string \| string[]` | Store name(s) to include in the transaction |
| `options` | `TransactionOptions` | Transaction configuration (optional) |

##### TransactionOptions

| Option | Type | Description |
| ------ | ---- | ----------- |
| `mode` | `"write"` | Transaction mode. Currently only `"write"` is supported |
| `durability` | `"default" \| "strict" \| "relaxed"` | Durability hint for the transaction. Default: `"default"` |

#### Transaction Object

| Property | Type | Description |
| -------- | ---- | ----------- |
| `raw` | `IDBTransaction` | Underlying IndexedDB transaction |
| `[storeName]` | `TransactionStoreAccessor` | Synchronous store accessor for each included store |

##### commit

```ts
commit(): Promise<void>
```

Commits all queued operations and waits for completion.

##### abort

```ts
abort(): void
```

Aborts the transaction, discarding all queued operations.

#### TransactionStoreAccessor

Synchronous operations for use within transactions. Operations are queued and executed when `commit()` is called.

##### put

```ts
put(value: T, key?: K): void
```

| Param | Type | Description |
| ----- | ---- | ----------- |
| `value` | `T` | Record to insert or update |
| `key` | `K` | Optional key (only needed if store has no keyPath) |

##### add

```ts
add(value: T, key?: K): void
```

| Param | Type | Description |
| ----- | ---- | ----------- |
| `value` | `T` | Record to insert |
| `key` | `K` | Optional key (only needed if store has no keyPath) |

##### delete

```ts
delete(key: K | IDBKeyRange): void
```

| Param | Type | Description |
| ----- | ---- | ----------- |
| `key` | `K \| IDBKeyRange` | Primary key or key range to delete |

##### clear

```ts
clear(): void
```

Queues deletion of all records in the store.

### defineStore

Creates a store definition with schema.

```ts
defineStore<N extends string, S extends StoreSchema>(
  name: N,
  schema: S
): SchemaStoreDefinition<N, S>
```

| Param | Type | Description |
| ----- | ---- | ----------- |
| `name` | `N` | Store name (used as `db.name` accessor) |
| `schema` | `S` | Object defining fields using `field` builders |

Returns a `SchemaStoreDefinition` with the following method:

#### addMigration

```ts
addMigration(
  name: string,
  fn: (db: IDBDatabase, tx: IDBTransaction) => void
): this
```

| Param | Type | Description |
| ----- | ---- | ----------- |
| `name` | `string` | Unique migration identifier (sorted alphabetically) |
| `fn` | `MigrationFn` | Migration function with access to database and transaction |

Migrations run during version upgrades in alphabetical order by name.

### field

Field type builders for schema definition.

#### field.string

```ts
field.string(): FieldBuilder<string>
```

Creates a string field.

#### field.number

```ts
field.number(): FieldBuilder<number>
```

Creates a number field.

#### field.boolean

```ts
field.boolean(): FieldBuilder<boolean>
```

Creates a boolean field.

#### field.date

```ts
field.date(): FieldBuilder<Date>
```

Creates a Date field.

#### field.object

```ts
field.object<S>(schema: (t: TypeFactory) => S): FieldBuilder<InferObjectType<S>>
```

| Param | Type | Description |
| ----- | ---- | ----------- |
| `schema` | `(t: TypeFactory) => S` | Function returning an object schema using type builders |

Creates a nested object field.

```ts
field.object(t => ({
  street: t.string(),
  city: t.string(),
  zipCode: t.number().optional(),
}))
```

#### field.tuple

```ts
field.tuple<T>(schema: (t: TypeFactory) => T): FieldBuilder<InferTupleType<T>>
```

| Param | Type | Description |
| ----- | ---- | ----------- |
| `schema` | `(t: TypeFactory) => T` | Function returning a tuple schema as array |

Creates a fixed-length tuple field.

```ts
field.tuple(t => [t.number(), t.number()])  // [number, number]
```

#### field.enum

```ts
field.enum<T extends readonly string[]>(values: T): FieldBuilder<T[number]>
```

| Param | Type | Description |
| ----- | ---- | ----------- |
| `values` | `readonly string[]` | Array of allowed string values |

Creates a string union type field.

```ts
field.enum(['active', 'inactive', 'pending'] as const)
```

#### field.nativeEnum

```ts
field.nativeEnum<T extends Record<string, string | number>>(enumObj: T): FieldBuilder<T[keyof T]>
```

| Param | Type | Description |
| ----- | ---- | ----------- |
| `enumObj` | `T` | TypeScript enum object |

Creates a field from a TypeScript enum.

```ts
enum Status { Active = 'active', Inactive = 'inactive' }
field.nativeEnum(Status)
```

### FieldBuilder

Methods available on all field builders. All methods return `this` for chaining.

#### primaryKey

```ts
primaryKey(): FieldBuilder
```

Marks the field as the store's primary key. Exactly one field per store must be marked as primary key.

#### index

```ts
index(options?: IndexOptions): FieldBuilder
```

| Param | Type | Description |
| ----- | ---- | ----------- |
| `options.unique` | `boolean` | If `true`, enforces unique values. Default: `false` |
| `options.multiEntry` | `boolean` | If `true`, indexes each array element separately. Default: `false` |

Creates an index on this field, enabling queries via `query()`, `getBy()`, and `getAllBy()`.

#### optional

```ts
optional(): FieldBuilder
```

Marks the field as optional, allowing `undefined` values.

#### default

```ts
default(value: T | (() => T)): FieldBuilder
```

| Param | Type | Description |
| ----- | ---- | ----------- |
| `value` | `T \| (() => T)` | Default value or factory function |

Sets a default value applied on read when the field is missing. Factory functions are called for each read.

```ts
field.number().default(0)
field.date().default(() => new Date())
```

#### array

```ts
array(): FieldBuilder<T[]>
```

Converts the field type to an array.

```ts
field.string().array()  // string[]
```

### Utility Functions

#### deleteDB

```ts
deleteDB(name: string): Promise<void>
```

| Param | Type | Description |
| ----- | ---- | ----------- |
| `name` | `string` | Database name to delete |

Deletes the database and all its data.

#### isIndexedDBAvailable

```ts
isIndexedDBAvailable(): boolean
```

Returns `true` if IndexedDB is available in the current environment.

### Type Utilities

#### InferStore

```ts
type InferStore<T> = /* inferred output type from store definition */
```

Extracts the TypeScript type from a store definition:

```ts
const usersStore = defineStore("users", {
  id: field.string().primaryKey(),
  name: field.string(),
  age: field.number().optional().default(0),
});

type User = InferStore<typeof usersStore>;
// { id: string; name: string; age: number }
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
