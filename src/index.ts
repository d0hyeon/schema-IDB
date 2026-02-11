/**
 * IDB Wrapper - Type-safe IndexedDB wrapper with chainable transactions
 *
 * @example Schema-based API (recommended)
 * ```ts
 * import { openDB, defineStore, field } from 'idb-wrapper';
 *
 * const usersStore = defineStore('users', {
 *   id: field.string().primaryKey(),
 *   name: field.string(),
 *   email: field.string().index({ unique: true }),
 *   age: field.number().optional().default(0),
 * });
 *
 * const db = await openDB({
 *   name: 'MyApp',
 *   version: 1,
 *   stores: [usersStore] as const,
 * });
 *
 * await db.users.put({ id: 'u1', name: 'Kim', email: 'kim@test.com' });
 * const user = await db.users.get('u1');
 * ```
 */

// Schema-based API (recommended)
export { defineStore } from './schema.js';
export { openDB } from './createSchemaDB.js';
export { field } from './field.js';

// Field types
export type {
  FieldBuilder,
  NumberFieldBuilder,
  FieldDef,
  TypeBuilder,
  TypeDef,
  TypeFactory,
  IndexOptions,
  AutoIncrementOptions,
  StoreSchema,
  InferInput,
  InferOutput,
  InferStore,
  DefinedStore,
  PrimaryKeyField,
  PrimaryKeyType,
  HasAutoIncrement,
  IndexedFields,
  IndexFieldTypes,
} from './field.js';

// Schema store types
export type { SchemaStoreDefinition, SchemaStoreBuilder, DefineStoreOptions } from './schema.js';

// Database types
export type {
  SchemaDBConfig,
  SchemaDatabase,
  SchemaStoreAccessor,
} from './createSchemaDB.js';

// Transaction types
export type {
  Transaction,
  TransactionOptions,
  TransactionStoreAccessor,
} from './transaction.js';

// Query types
export type {
  QueryOptions,
  TypedQueryOptions,
  QueryBuilder,
  TypedQueryBuilder,
  IndexQueryBuilder,
  TypedIndexQueryBuilder,
  FinalQueryBuilder,
  SortOrder,
  WhereCondition,
} from './query.js';

// Utilities
export {
  promisifyRequest,
  promisifyTransaction,
  openDatabase,
  deleteDB,
  isIndexedDBAvailable,
} from './utils.js';

// Legacy types (for internal use)
export type {
  StoreDefinition,
  IndexDefinition,
  Migration,
  MigrationFn,
} from './types.js';
