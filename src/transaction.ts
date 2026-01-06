/**
 * Transaction support for multi-store atomic operations
 */

import type { StoreSchema, InferInput, PrimaryKeyType, IndexedFields } from './field.js';
import type { SchemaStoreDefinition } from './schema.js';

// ============================================================================
// IDB Key Type Constraint
// ============================================================================

/**
 * Constraint type that ensures PrimaryKeyType is compatible with IDBValidKey
 * IndexedDB accepts: string | number | Date | BufferSource | IDBValidKey[]
 */
type IDBCompatibleKey = IDBValidKey;

/**
 * Constrained primary key type that ensures IDB compatibility
 * This allows the type system to accept PrimaryKeyType without explicit casting
 */
type ConstrainedKey<S extends StoreSchema> = PrimaryKeyType<S> & IDBCompatibleKey;

// ============================================================================
// Transaction Options
// ============================================================================

export interface TransactionOptions {
  mode?: 'write';
  durability?: 'default' | 'strict' | 'relaxed';
}

// ============================================================================
// Transaction Store Accessor (Sync operations)
// ============================================================================

/**
 * Synchronous store operations within a transaction
 * All methods queue requests without awaiting - call tx.commit() at the end
 */
export interface TransactionStoreAccessor<S extends StoreSchema> {
  /** Get a record by key (queues request) */
  get(key: ConstrainedKey<S>): void;

  /** Get all records (queues request) */
  getAll(): void;

  /** Get records by index (queues request) */
  getAllByIndex<I extends IndexedFields<S> & string>(
    indexName: I,
    query?: IDBKeyRange | IDBValidKey
  ): void;

  /** Put a record (queues request) */
  put(value: InferInput<S>, key?: ConstrainedKey<S>): void;

  /** Add a record (queues request) */
  add(value: InferInput<S>, key?: ConstrainedKey<S>): void;

  /** Delete a record (queues request) */
  delete(key: ConstrainedKey<S> | IDBKeyRange): void;

  /** Clear all records (queues request) */
  clear(): void;
}

// ============================================================================
// Transaction Implementation
// ============================================================================

function createTransactionStoreAccessor<S extends StoreSchema>(
  tx: IDBTransaction,
  storeName: string,
): TransactionStoreAccessor<S> {
  const store = tx.objectStore(storeName);

  return {
    get(key) {
      store.get(key);
    },

    getAll() {
      store.getAll();
    },

    getAllByIndex(indexName, query) {
      const index = store.index(indexName);
      index.getAll(query);
    },

    put(value, key) {
      store.put(value, key);
    },

    add(value, key) {
      store.add(value, key);
    },

    delete(key) {
      store.delete(key);
    },

    clear() {
      store.clear();
    },
  };
}

// ============================================================================
// Transaction Type Helpers
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySchemaStore = SchemaStoreDefinition<any, string>;

/** Extract store names from store definitions array */
type StoreNames<TStores extends readonly AnySchemaStore[]> = TStores[number]['name'];

/** Get schema for a specific store name */
type GetStoreSchema<TStores extends readonly AnySchemaStore[], TName extends string> = 
  Extract<TStores[number], { name: TName }>['schema'];

/** Transaction object with typed store accessors */
export type Transaction<
  TStores extends readonly AnySchemaStore[],
  TNames extends StoreNames<TStores>
> = {
  [K in TNames]: TransactionStoreAccessor<GetStoreSchema<TStores, K>>;
} & {
  /** The underlying IDBTransaction */
  readonly raw: IDBTransaction;
  /** Commit the transaction and wait for completion */
  commit(): Promise<void>;
  /** Abort the transaction */
  abort(): void;
};

// ============================================================================
// Start Transaction Function
// ============================================================================

/**
 * Build transaction object with proper typing
 * Centralizes the type assertion for transaction creation
 */
function buildTransaction<
  TStores extends readonly AnySchemaStore[],
  TNames extends StoreNames<TStores>
>(
  storeAccessors: Record<string, TransactionStoreAccessor<StoreSchema>>,
  raw: IDBTransaction,
  commit: () => Promise<void>,
  abort: () => void
): Transaction<TStores, TNames> {
  return {
    ...storeAccessors,
    raw,
    commit,
    abort,
  } as Transaction<TStores, TNames>;
}

export function createStartTransaction<TStores extends readonly AnySchemaStore[]>(
  db: IDBDatabase,
  _storeDefinitions: TStores
) {
  return function startTransaction<TNames extends StoreNames<TStores>>(
    storeNamesInput: TNames | TNames[],
    options: TransactionOptions = {}
  ): Transaction<TStores, TNames> {
    const storeNames = Array.isArray(storeNamesInput) ? storeNamesInput : [storeNamesInput];
    const { mode, durability = 'default' } = options;
    const idbMode: IDBTransactionMode = mode === 'write' ? 'readwrite' : 'readwrite';

    const tx = db.transaction(storeNames, idbMode, { durability });

    // Create store accessors
    const storeAccessors: Record<string, TransactionStoreAccessor<StoreSchema>> = {};
    for (const name of storeNames) {
      storeAccessors[name] = createTransactionStoreAccessor(tx, name);
    }

    // Commit function
    const commit = (): Promise<void> => {
      return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(new Error('Transaction aborted'));

        // IndexedDB auto-commits when all requests are done
        // We just wait for oncomplete
      });
    };

    // Abort function
    const abort = (): void => {
      tx.abort();
    };

    return buildTransaction<TStores, TNames>(storeAccessors, tx, commit, abort);
  };
}
