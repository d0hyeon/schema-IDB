import type { Migration } from './types.js';
import type {
  StoreSchema,
  InferInput,
  InferOutput,
  PrimaryKeyType,
  IndexedFields,
  IndexFieldTypes,
} from './field.js';
import type { SchemaStoreDefinition } from './schema.js';
import type { TypedQueryOptions, TypedQueryBuilder } from './query.js';
import type { Transaction, TransactionOptions } from './transaction.js';
import { openDatabase } from './utils.js';
import { createStoreAccessor } from './storeAccessor.js';
import { createStartTransaction } from './transaction.js';
import {
  determineAutoVersion,
  applySafeChanges,
  openDatabaseForSchemaRead,
  readExistingSchema,
  toDesiredSchema,
  detectSchemaChanges,
  type SchemaChanges,
  type SchemaChangeType,
} from './schemaDetection.js';
import {
  ensureSchemaHistoryStore,
  getAppliedMigrations,
  recordMigrationApplied,
  initializeSchemaHistory,
} from './migrationHistory.js';

// ============================================================================
// Types
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySchemaStore = SchemaStoreDefinition<any, string>;

/** Extract store names from store definitions array */
type StoreNames<TStores extends readonly AnySchemaStore[]> = TStores[number]['name'];

/**
 * Store accessor with input/output types and query support
 */
export interface SchemaStoreAccessor<S extends StoreSchema> {
  get(key: PrimaryKeyType<S>): Promise<InferOutput<S> | undefined>;
  getAll(): Promise<InferOutput<S>[]>;
  getBy<I extends IndexedFields<S> & string>(
    indexName: I,
    query: IDBKeyRange | IndexFieldTypes<S>[I]
  ): Promise<InferOutput<S> | undefined>;
  getAllBy<I extends IndexedFields<S> & string>(
    indexName: I,
    query?: IDBKeyRange | IndexFieldTypes<S>[I]
  ): Promise<InferOutput<S>[]>;
  put(value: InferInput<S>, key?: PrimaryKeyType<S>): Promise<PrimaryKeyType<S>>;
  add(value: InferInput<S>, key?: PrimaryKeyType<S>): Promise<PrimaryKeyType<S>>;
  delete(key: PrimaryKeyType<S> | IDBKeyRange): Promise<void>;
  clear(): Promise<void>;
  count(query?: IDBKeyRange | IDBValidKey): Promise<number>;

  // Query API (type-safe)
  query(options: TypedQueryOptions<S>): Promise<InferOutput<S>[]>;
  query(): TypedQueryBuilder<InferOutput<S>, PrimaryKeyType<S>, S>;
}

/**
 * Database config for schema-based stores
 */
export interface SchemaDBConfig<TStores extends readonly AnySchemaStore[]> {
  name: string;
  version?: number;
  versionStrategy?: 'explicit' | 'auto';
  /**
   * Strategy for handling stores removed from schema
   * - 'error': Throw an error (default)
   * - 'preserve': Rename to __storeName_deleted_v{version}__ as backup
   */
  removedStoreStrategy?: 'error' | 'preserve';
  stores: TStores;
  onBlocked?: () => void;
  onVersionChange?: () => void;
}

/**
 * Database instance with typed store accessors
 */
export type SchemaDatabase<TStores extends readonly AnySchemaStore[]> = {
  readonly name: string;
  readonly version: number;
  readonly raw: IDBDatabase;

  /** Whether the database is ready for operations */
  readonly ready: boolean;

  /** Wait for the database to be ready */
  waitForReady(): Promise<void>;

  close(): void;

  /** Start a transaction for atomic multi-store operations */
  startTransaction<TNames extends StoreNames<TStores>>(
    storeNames: TNames | TNames[],
    options?: TransactionOptions
  ): Transaction<TStores, TNames>;
} & {
  [K in TStores[number]['name']]: SchemaStoreAccessor<
    Extract<TStores[number], { name: K }>['schema']
  >;
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get keyPath as string for IDBObjectStoreParameters
 * IndexedDB accepts string | string[] for keyPath
 */
function getKeyPathString(keyPath: string | string[] | undefined): string | string[] | undefined {
  return keyPath;
}

/**
 * Internal state for lazy database initialization
 */
interface DatabaseState<TStores extends readonly AnySchemaStore[]> {
  idb: IDBDatabase | null;
  ready: boolean;
  error: Error | null;
  readyPromise: Promise<void>;
  readyResolve: () => void;
  readyReject: (error: Error) => void;
  stores: TStores;
  startTransaction: ReturnType<typeof createStartTransaction<TStores>> | null;
}

/**
 * Create a store accessor proxy that auto-waits for ready state
 */
function createLazyStoreAccessor<TStores extends readonly AnySchemaStore[]>(
  state: DatabaseState<TStores>,
  storeName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  defaults: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  // Helper to get the real accessor after ready
  const getAccessor = async () => {
    await state.readyPromise;
    if (!state.idb) {
      throw new Error('Database initialization failed');
    }
    return createStoreAccessor(state.idb, storeName, defaults);
  };

  // Create a proxy that wraps all methods
  return new Proxy({}, {
    get(_target, prop) {
      if (prop === 'query') {
        // Special handling for query - return function that returns lazy query builder
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (options?: any) => {
          if (options) {
            // Options-based query returns promise
            return getAccessor().then(accessor => accessor.query(options));
          }
          // Return lazy query builder proxy
          return createLazyQueryBuilder(state, storeName, defaults);
        };
      }

      // For all other methods, return async wrapper
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return async (...args: any[]) => {
        const accessor = await getAccessor();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (accessor as any)[prop](...args);
      };
    },
  });
}

/**
 * Create a lazy query builder proxy that auto-waits for ready state
 */
function createLazyQueryBuilder<TStores extends readonly AnySchemaStore[]>(
  state: DatabaseState<TStores>,
  storeName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  defaults: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  const getQueryBuilder = async () => {
    await state.readyPromise;
    if (!state.idb) {
      throw new Error('Database initialization failed');
    }
    return createStoreAccessor(state.idb, storeName, defaults).query();
  };

  // Create a proxy that wraps the query builder
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createBuilderProxy = (getBuilder: () => Promise<any>): any => {
    return new Proxy({}, {
      get(_target, prop) {
        // Terminal methods that return promises
        if (prop === 'findAll' || prop === 'find' || prop === 'count') {
          return () => getBuilder().then(b => b[prop]());
        }

        // Chaining methods - return new proxy
        return (...args: unknown[]) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const newGetBuilder = () => getBuilder().then(b => (b as any)[prop](...args));

          // Check if this returns another builder (index, where) or a final builder
          // Return a proxy for the result
          return createBuilderProxy(newGetBuilder);
        };
      },
    });
  };

  return createBuilderProxy(getQueryBuilder);
}

/**
 * Build database object with store accessors
 * Creates a lazy-initialized database that becomes ready asynchronously
 */
function buildSchemaDatabase<TStores extends readonly AnySchemaStore[]>(
  state: DatabaseState<TStores>,
  configName: string
): SchemaDatabase<TStores> {
  const database: Record<string, unknown> = {
    get name() {
      return state.idb?.name ?? configName;
    },
    get version() {
      return state.idb?.version ?? 0;
    },
    get raw() {
      if (!state.idb) {
        throw new Error('Database not ready. Call waitForReady() first or check ready property.');
      }
      return state.idb;
    },
    get ready() {
      return state.ready;
    },
    waitForReady() {
      return state.readyPromise;
    },
    close() {
      state.idb?.close();
    },
    startTransaction(...args: unknown[]) {
      if (!state.startTransaction) {
        // Return a proxy that waits for ready
        const [storeNamesInput, options] = args as [string | string[], TransactionOptions?];
        const storeNames = Array.isArray(storeNamesInput) ? storeNamesInput : [storeNamesInput];
        return createLazyTransaction(state, storeNames, options);
      }
      return state.startTransaction(...args as Parameters<typeof state.startTransaction>);
    },
  };

  // Add store accessors with auto-wait behavior
  for (const store of state.stores) {
    Object.defineProperty(database, store.name, {
      get() {
        return createLazyStoreAccessor(state, store.name, store.defaults);
      },
      enumerable: true,
    });
  }

  return database as SchemaDatabase<TStores>;
}

/**
 * Create a lazy transaction that waits for ready state
 */
function createLazyTransaction<TStores extends readonly AnySchemaStore[]>(
  state: DatabaseState<TStores>,
  storeNames: string[],
  options?: TransactionOptions
): Transaction<TStores, string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lazyTx: any = {
    get raw() {
      throw new Error('Transaction raw is not available before ready state. Use await db.waitForReady() before starting transactions.');
    },
    async commit() {
      await state.readyPromise;
      if (!state.startTransaction) {
        throw new Error('Database initialization failed');
      }
      const realTx = state.startTransaction(storeNames, options);
      return realTx.commit();
    },
    abort() {
      // No-op if not ready yet
    },
  };

  // Add store accessors to transaction
  for (const storeName of storeNames) {
    const store = state.stores.find(s => s.name === storeName);
    if (store) {
      Object.defineProperty(lazyTx, storeName, {
        get() {
          throw new Error('Transaction operations before ready state are not yet supported. Use await db.waitForReady() before starting transactions.');
        },
        enumerable: true,
      });
    }
  }

  return lazyTx as Transaction<TStores, string>;
}

function collectMigrations(stores: readonly AnySchemaStore[]): Migration[] {
  const allMigrations: Migration[] = [];
  const seenNames = new Set<string>();

  for (const store of stores) {
    for (const migration of store.migrations) {
      // Check for duplicate migration names across stores
      if (seenNames.has(migration.name)) {
        throw new Error(`Duplicate migration name "${migration.name}" found across stores`);
      }
      seenNames.add(migration.name);
      allMigrations.push(migration);
    }
  }

  // Sort by name (alphabetical order)
  return allMigrations.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Filter migrations to only include those not yet applied
 */
function filterPendingMigrations(
  allMigrations: Migration[],
  appliedMigrations: string[]
): Migration[] {
  const appliedSet = new Set(appliedMigrations);
  return allMigrations
    .filter(m => !appliedSet.has(m.name))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function handleUpgrade(
  db: IDBDatabase,
  tx: IDBTransaction,
  oldVersion: number,
  stores: readonly AnySchemaStore[],
  pendingMigrations: Migration[],
  appliedMigrations: string[],
  autoChanges: SchemaChanges | null
): void {
  // Ensure __schema_history__ store exists
  ensureSchemaHistoryStore(db);

  // Create user stores on fresh database
  if (oldVersion === 0) {
    for (const store of stores) {
      const objectStore = db.createObjectStore(store.name, {
        keyPath: getKeyPathString(store.keyPath),
      });

      for (const index of store.indexes) {
        objectStore.createIndex(index.name, index.keyPath, {
          unique: index.unique ?? false,
          multiEntry: index.multiEntry ?? false,
        });
      }
    }

    // Initialize schema history
    initializeSchemaHistory(tx);
  } else if (autoChanges && autoChanges.safe.length > 0) {
    // Apply auto-detected safe schema changes
    applySafeChanges(db, tx, autoChanges.safe, stores);
  }

  // Run pending migrations (those not yet applied)
  let currentApplied = [...appliedMigrations];

  for (const migration of pendingMigrations) {
    try {
      const result = migration.up(db, tx);

      if (result instanceof Promise) {
        result.catch((err) => {
          console.error(`Migration "${migration.name}" failed:`, err);
          tx.abort();
        });
      }

      // Record migration as applied
      recordMigrationApplied(tx, migration.name, currentApplied);
      currentApplied = [...currentApplied, migration.name].sort();
    } catch (err) {
      console.error(`Migration "${migration.name}" failed:`, err);
      tx.abort();
      throw err;
    }
  }
}

// ============================================================================
// openDB Function
// ============================================================================

/**
 * Create a database with schema-based store definitions
 *
 * Returns a database object immediately (synchronously).
 * Use `db.ready` to check if initialization is complete, or
 * `await db.waitForReady()` to wait for the database to be ready.
 *
 * @example
 * ```ts
 * import { openDB, defineStore, field } from 'idb-wrapper';
 *import { withStatement } from '../playground/node_modules/@babel/types/lib/index-legacy.d';

 * const usersStore = defineStore('users', {
 *   id: field.string().primaryKey(),
 *   name: field.string(),
 *   email: field.string().index({ unique: true }),
 *   age: field.number().optional().default(0),
 * });
 *
 * const db = openDB({
 *   name: 'MyApp',
 *   version: 1,
 *   stores: [usersStore] as const,
 * });
 *
 * // Wait for database to be ready before operations
 * await db.waitForReady();
 *
 * // Typed operations
 * await db.users.put({ id: 'u1', name: 'Kim', email: 'kim@test.com' });
 * const user = await db.users.get('u1');  // age will have default value 0
 * ```
 */
export function openDB<const TStores extends readonly AnySchemaStore[]>(
  config: SchemaDBConfig<TStores>
): SchemaDatabase<TStores> {
  const {
    name,
    version: explicitVersion,
    versionStrategy = 'explicit',
    removedStoreStrategy = 'error',
    stores,
    onBlocked,
    onVersionChange,
  } = config;

  // Validate stores (synchronous validation)
  const storeNames = new Set<string>();
  for (const store of stores) {
    if (storeNames.has(store.name)) {
      throw new Error(`Duplicate store name: "${store.name}"`);
    }
    storeNames.add(store.name);
  }

  // Collect all migrations from stores (synchronous)
  const allMigrations = collectMigrations(stores);

  // Create state for lazy initialization
  let readyResolve: () => void = () => {};
  let readyReject: (error: Error) => void = () => {};

  const readyPromise = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });

  const state: DatabaseState<TStores> = {
    idb: null,
    ready: false,
    error: null,
    readyPromise,
    readyResolve,
    readyReject,
    stores,
    startTransaction: null,
  };

  // Build the database object immediately
  const database = buildSchemaDatabase(state, name);

  // Start async initialization
  initializeDatabase(
    state,
    name,
    explicitVersion,
    versionStrategy,
    removedStoreStrategy,
    stores,
    allMigrations,
    onBlocked,
    onVersionChange
  );

  return database;
}

/**
 * Async initialization logic
 */
async function initializeDatabase<TStores extends readonly AnySchemaStore[]>(
  state: DatabaseState<TStores>,
  name: string,
  explicitVersion: number | undefined,
  versionStrategy: 'explicit' | 'auto',
  removedStoreStrategy: 'error' | 'preserve',
  stores: TStores,
  allMigrations: Migration[],
  onBlocked?: () => void,
  onVersionChange?: () => void
): Promise<void> {
  try {
    // Get applied migrations from existing database (if any)
    let appliedMigrations: string[] = [];
    let autoChanges: SchemaChanges | null = null;
    let version: number;

    if (versionStrategy === 'auto') {
      // Auto-detect schema changes and determine version
      const autoResult = await determineAutoVersion(name, stores, { removedStoreStrategy });
      version = autoResult.version;
      autoChanges = autoResult.changes;

      // Try to read applied migrations from existing database
      if (autoResult.version > 1) {
        const existingDb = await openDatabaseForSchemaRead(name);
        if (existingDb) {
          appliedMigrations = await getAppliedMigrations(existingDb);
          existingDb.close();
        }
      }

      // Check if there are pending migrations that require a version bump
      const pendingCheck = filterPendingMigrations(allMigrations, appliedMigrations);
      if (pendingCheck.length > 0 && !autoResult.needsUpgrade) {
        // We have pending migrations but no schema changes, bump version to trigger upgrade
        version = autoResult.version + 1;
      }
    } else {
      if (explicitVersion === undefined) {
        throw new Error('Version is required when versionStrategy is "explicit"');
      }
      version = explicitVersion;

      // Try to read applied migrations for explicit version strategy too
      const existingDb = await openDatabaseForSchemaRead(name);
      if (existingDb) {
        const currentVersion = existingDb.version;
        appliedMigrations = await getAppliedMigrations(existingDb);

        // In explicit mode, validate schema changes directly from the open DB
        // (Don't call determineAutoVersion which would try to open DB again)
        const existingSchema = readExistingSchema(existingDb);
        const desiredSchema = toDesiredSchema(stores);
        existingDb.close();

        const changes = detectSchemaChanges(existingSchema, desiredSchema);

        if (changes.hasChanges) {
          // Process dangerous changes based on removedStoreStrategy
          const remainingDangerous: SchemaChangeType[] = [];

          for (const change of changes.dangerous) {
            if (change.type === 'store_delete') {
              if (removedStoreStrategy === 'preserve') {
                // Convert store_delete to store_rename (safe change)
                // Use currentVersion (the version when store was last active)
                changes.safe.push({
                  type: 'store_rename',
                  oldName: change.storeName,
                  newName: `__${change.storeName}_deleted_v${currentVersion}__`,
                });
              } else {
                // Keep as dangerous - will throw error
                remainingDangerous.push(change);
              }
            } else {
              // Other dangerous changes remain dangerous
              remainingDangerous.push(change);
            }
          }

          // Throw error if there are dangerous changes
          if (remainingDangerous.length > 0) {
            const dangerousDescriptions = remainingDangerous.map(c => {
              switch (c.type) {
                case 'store_delete':
                  return `Store "${c.storeName}" would be deleted. Use removedStoreStrategy: 'preserve' to backup, or add a migration to explicitly delete it.`;
                case 'keypath_change':
                  return `Store "${c.storeName}" keyPath changed from "${c.oldKeyPath}" to "${c.newKeyPath}". This requires recreating the store with a manual migration.`;
                default:
                  return `Unknown dangerous change`;
              }
            });

            const errorMessage =
              `Dangerous schema changes detected:\n${dangerousDescriptions.join('\n')}\n\n` +
              `Add explicit migrations to handle these changes safely.`;

            console.error('[schema-idb]', errorMessage);
            throw new Error(errorMessage);
          }

          changes.dangerous = remainingDangerous;
          autoChanges = changes;

          // If schema changes detected but version not bumped, warn the developer
          if (version <= currentVersion) {
            const changeDescriptions = changes.safe.map(c => {
              switch (c.type) {
                case 'store_add': return `- Add store "${c.storeName}"`;
                case 'store_rename': return `- Rename store "${c.oldName}" to "${c.newName}"`;
                case 'index_add': return `- Add index "${c.indexName}" on "${c.storeName}"`;
                case 'index_delete': return `- Delete index "${c.indexName}" from "${c.storeName}"`;
                default: return `- Schema change`;
              }
            });

            console.warn(
              `[schema-idb] Schema changes detected but version not bumped:\n` +
              `${changeDescriptions.join('\n')}\n` +
              `Current DB version: ${currentVersion}, Provided version: ${version}\n` +
              `Bump the version to apply these changes.`
            );
          }
        }
      }
    }

    // Calculate pending migrations
    const pendingMigrations = filterPendingMigrations(allMigrations, appliedMigrations);

    // Open database
    const idb = await openDatabase(
      name,
      version,
      (db, tx, oldVersion) => {
        handleUpgrade(db, tx, oldVersion, stores, pendingMigrations, appliedMigrations, autoChanges);
      },
      onBlocked
    );

    // Set up version change handler
    if (onVersionChange) {
      idb.onversionchange = onVersionChange;
    }

    // Update state
    state.idb = idb;
    state.startTransaction = createStartTransaction(idb, stores);
    state.ready = true;
    state.readyResolve();
  } catch (error) {
    state.error = error instanceof Error ? error : new Error(String(error));
    state.readyReject(state.error);
  }
}
