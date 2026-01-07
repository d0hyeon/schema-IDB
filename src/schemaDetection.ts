/**
 * Schema change detection and auto-migration
 *
 * Safe auto-migrations:
 * - New store creation
 * - New index creation
 * - Index deletion
 *
 * Dangerous changes (require manual migration):
 * - Store deletion
 * - keyPath changes
 */

import type { IndexDefinition } from './types.js';

// ============================================================================
// Internal Store Filtering
// ============================================================================

/**
 * Check if a store name is an internal store (starts with __)
 */
function isInternalStore(storeName: string): boolean {
  return storeName.startsWith('__');
}

// ============================================================================
// Types
// ============================================================================

/** Represents the current schema of an existing store in IndexedDB */
export interface ExistingStoreSchema {
  name: string;
  keyPath: string | string[] | null;
  indexes: Map<string, {
    keyPath: string | string[];
    unique: boolean;
    multiEntry: boolean;
  }>;
}

/** Represents the desired schema from store definitions */
export interface DesiredStoreSchema {
  name: string;
  keyPath: string | string[] | undefined;
  indexes: IndexDefinition[];
}

/** Schema change types */
export type SchemaChangeType =
  | { type: 'store_add'; storeName: string }
  | { type: 'store_delete'; storeName: string }
  | { type: 'store_rename'; oldName: string; newName: string }
  | { type: 'keypath_change'; storeName: string; oldKeyPath: string | string[] | null; newKeyPath: string | string[] | undefined }
  | { type: 'index_add'; storeName: string; indexName: string; index: IndexDefinition }
  | { type: 'index_delete'; storeName: string; indexName: string }
  | { type: 'index_modify'; storeName: string; indexName: string; oldIndex: { keyPath: string | string[]; unique: boolean; multiEntry: boolean }; newIndex: IndexDefinition };

/** Result of schema comparison */
export interface SchemaChanges {
  safe: SchemaChangeType[];
  dangerous: SchemaChangeType[];
  hasChanges: boolean;
}

// ============================================================================
// Schema Reading
// ============================================================================

/**
 * Read the current schema from an existing IndexedDB database
 */
export function readExistingSchema(db: IDBDatabase): Map<string, ExistingStoreSchema> {
  const schemas = new Map<string, ExistingStoreSchema>();

  // Convert DOMStringList to array, filtering out internal stores
  const storeNamesList = Array.from({ length: db.objectStoreNames.length }, (_, i) => db.objectStoreNames.item(i)!)
    .filter(name => !isInternalStore(name));

  for (const storeName of storeNamesList) {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);

    const indexes = new Map<string, { keyPath: string | string[]; unique: boolean; multiEntry: boolean }>();

    // Convert DOMStringList to array
    const indexNamesList = Array.from({ length: store.indexNames.length }, (_, i) => store.indexNames.item(i)!);

    for (const indexName of indexNamesList) {
      const index = store.index(indexName);
      indexes.set(indexName, {
        keyPath: index.keyPath as string | string[],
        unique: index.unique,
        multiEntry: index.multiEntry,
      });
    }

    schemas.set(storeName, {
      name: storeName,
      keyPath: store.keyPath as string | string[] | null,
      indexes,
    });

    tx.abort(); // We only needed to read metadata
  }

  return schemas;
}

/**
 * Convert store definitions to desired schema format
 */
export function toDesiredSchema(stores: readonly { name: string; keyPath: string | string[] | undefined; indexes: IndexDefinition[] }[]): Map<string, DesiredStoreSchema> {
  const schemas = new Map<string, DesiredStoreSchema>();

  for (const store of stores) {
    schemas.set(store.name, {
      name: store.name,
      keyPath: store.keyPath,
      indexes: store.indexes,
    });
  }

  return schemas;
}

// ============================================================================
// Schema Comparison
// ============================================================================

/**
 * Compare keyPaths for equality
 */
function keyPathEquals(a: string | string[] | null | undefined, b: string | string[] | null | undefined): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => v === b[i]);
  }

  return a === b;
}

/**
 * Compare two schemas and detect changes
 */
export function detectSchemaChanges(
  existing: Map<string, ExistingStoreSchema>,
  desired: Map<string, DesiredStoreSchema>
): SchemaChanges {
  const safe: SchemaChangeType[] = [];
  const dangerous: SchemaChangeType[] = [];

  // Check for new stores and modified stores
  for (const [storeName, desiredStore] of desired) {
    const existingStore = existing.get(storeName);

    if (!existingStore) {
      // New store - safe to add
      safe.push({ type: 'store_add', storeName });
      continue;
    }

    // Check keyPath changes - DANGEROUS
    if (!keyPathEquals(existingStore.keyPath, desiredStore.keyPath)) {
      dangerous.push({
        type: 'keypath_change',
        storeName,
        oldKeyPath: existingStore.keyPath,
        newKeyPath: desiredStore.keyPath,
      });
      continue; // Skip index checks for stores with keyPath changes
    }

    // Check for new indexes
    for (const desiredIndex of desiredStore.indexes) {
      const existingIndex = existingStore.indexes.get(desiredIndex.name);

      if (!existingIndex) {
        // New index - safe to add
        safe.push({
          type: 'index_add',
          storeName,
          indexName: desiredIndex.name,
          index: desiredIndex,
        });
      } else {
        // Check if index definition changed
        const keyPathChanged = !keyPathEquals(existingIndex.keyPath, desiredIndex.keyPath);
        const uniqueChanged = existingIndex.unique !== (desiredIndex.unique ?? false);
        const multiEntryChanged = existingIndex.multiEntry !== (desiredIndex.multiEntry ?? false);

        if (keyPathChanged || uniqueChanged || multiEntryChanged) {
          // Index modified - treat as delete + add (safe)
          safe.push({
            type: 'index_delete',
            storeName,
            indexName: desiredIndex.name,
          });
          safe.push({
            type: 'index_add',
            storeName,
            indexName: desiredIndex.name,
            index: desiredIndex,
          });
        }
      }
    }

    // Check for deleted indexes - safe to remove
    const desiredIndexNames = new Set(desiredStore.indexes.map(i => i.name));
    for (const existingIndexName of existingStore.indexes.keys()) {
      if (!desiredIndexNames.has(existingIndexName)) {
        safe.push({
          type: 'index_delete',
          storeName,
          indexName: existingIndexName,
        });
      }
    }
  }

  // Check for deleted stores - DANGEROUS
  for (const storeName of existing.keys()) {
    if (!desired.has(storeName)) {
      dangerous.push({ type: 'store_delete', storeName });
    }
  }

  return {
    safe,
    dangerous,
    hasChanges: safe.length > 0 || dangerous.length > 0,
  };
}

// ============================================================================
// Auto Migration
// ============================================================================

/**
 * Apply safe schema changes during upgrade
 */
export function applySafeChanges(
  db: IDBDatabase,
  tx: IDBTransaction,
  changes: SchemaChangeType[],
  stores: readonly { name: string; keyPath: string | string[] | undefined; indexes: IndexDefinition[] }[]
): void {
  // Process renames - collect store info first, then delete, then create new
  const renameChanges = changes.filter((c): c is Extract<SchemaChangeType, { type: 'store_rename' }> => c.type === 'store_rename');

  // Collect data from stores to be renamed before deleting them
  const renameDataMap = new Map<string, {
    keyPath: string | string[] | null;
    indexes: Array<{ name: string; keyPath: string | string[]; unique: boolean; multiEntry: boolean }>;
    newName: string;
  }>();

  for (const change of renameChanges) {
    const oldStore = tx.objectStore(change.oldName);

    // Collect index info
    const indexes: Array<{ name: string; keyPath: string | string[]; unique: boolean; multiEntry: boolean }> = [];
    const indexNames = Array.from({ length: oldStore.indexNames.length }, (_, i) => oldStore.indexNames.item(i)!);
    for (const indexName of indexNames) {
      const index = oldStore.index(indexName);
      indexes.push({
        name: indexName,
        keyPath: index.keyPath as string | string[],
        unique: index.unique,
        multiEntry: index.multiEntry,
      });
    }

    renameDataMap.set(change.oldName, {
      keyPath: oldStore.keyPath,
      indexes,
      newName: change.newName,
    });

    // Queue getAll request - it will complete before transaction ends
    const getAllRequest = oldStore.getAll();
    getAllRequest.onsuccess = () => {
      const records = getAllRequest.result;

      // Create new store and copy data
      const storeInfo = renameDataMap.get(change.oldName)!;
      const newStore = db.createObjectStore(storeInfo.newName, {
        keyPath: storeInfo.keyPath as string | string[] | undefined,
      });

      // Create indexes
      for (const idx of storeInfo.indexes) {
        newStore.createIndex(idx.name, idx.keyPath, {
          unique: idx.unique,
          multiEntry: idx.multiEntry,
        });
      }

      // Copy records
      for (const record of records) {
        newStore.put(record);
      }
    };

    // Delete old store immediately (getAll request already queued)
    db.deleteObjectStore(change.oldName);
  }

  // Then process other changes
  for (const change of changes) {
    switch (change.type) {
      case 'store_add': {
        const storeDefinition = stores.find(s => s.name === change.storeName);
        if (storeDefinition) {
          const objectStore = db.createObjectStore(storeDefinition.name, {
            keyPath: storeDefinition.keyPath,
          });

          for (const index of storeDefinition.indexes) {
            objectStore.createIndex(index.name, index.keyPath, {
              unique: index.unique ?? false,
              multiEntry: index.multiEntry ?? false,
            });
          }
        }
        break;
      }

      case 'index_add': {
        const store = tx.objectStore(change.storeName);
        store.createIndex(change.indexName, change.index.keyPath, {
          unique: change.index.unique ?? false,
          multiEntry: change.index.multiEntry ?? false,
        });
        break;
      }

      case 'index_delete': {
        const store = tx.objectStore(change.storeName);
        store.deleteIndex(change.indexName);
        break;
      }
    }
  }
}

// ============================================================================
// Schema Fingerprint
// ============================================================================

/**
 * Generate a hash/fingerprint of the schema for version detection
 * This is used to detect if schema has changed
 */
export function generateSchemaFingerprint(
  stores: readonly { name: string; keyPath: string | string[] | undefined; indexes: IndexDefinition[] }[]
): string {
  const normalized = stores
    .map(store => ({
      name: store.name,
      keyPath: store.keyPath,
      indexes: store.indexes
        .map(i => ({
          name: i.name,
          keyPath: i.keyPath,
          unique: i.unique ?? false,
          multiEntry: i.multiEntry ?? false,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return JSON.stringify(normalized);
}

/**
 * Simple hash function for fingerprint
 */
export function hashFingerprint(fingerprint: string): number {
  let hash = 0;
  for (let i = 0; i < fingerprint.length; i++) {
    const char = fingerprint.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

// ============================================================================
// Version Detection
// ============================================================================

/**
 * Get the current version of an existing database
 * Returns 0 if database doesn't exist
 */
export async function getCurrentDatabaseVersion(dbName: string): Promise<number> {
  return new Promise((resolve) => {
    const request = indexedDB.open(dbName);

    request.onsuccess = () => {
      const db = request.result;
      const version = db.version;
      db.close();
      resolve(version);
    };

    request.onerror = () => {
      resolve(0);
    };
  });
}

/**
 * Open database temporarily to read schema
 * Returns null if database doesn't exist
 */
export async function openDatabaseForSchemaRead(dbName: string): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    const request = indexedDB.open(dbName);

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      resolve(null);
    };

    request.onupgradeneeded = () => {
      // Database is being created, abort and return null
      request.transaction?.abort();
      resolve(null);
    };
  });
}

/** Options for determineAutoVersion */
export interface AutoVersionOptions {
  removedStoreStrategy?: 'error' | 'preserve';
}

/**
 * Determine the version needed for auto-versioning
 */
export async function determineAutoVersion(
  dbName: string,
  stores: readonly { name: string; keyPath: string | string[] | undefined; indexes: IndexDefinition[] }[],
  options: AutoVersionOptions = {}
): Promise<{ version: number; changes: SchemaChanges | null; needsUpgrade: boolean }> {
  const { removedStoreStrategy = 'error' } = options;
  const existingDb = await openDatabaseForSchemaRead(dbName);

  if (!existingDb) {
    // Database doesn't exist, start with version 1
    return { version: 1, changes: null, needsUpgrade: true };
  }

  const currentVersion = existingDb.version;
  const existingSchema = readExistingSchema(existingDb);
  const desiredSchema = toDesiredSchema(stores);

  existingDb.close();

  const changes = detectSchemaChanges(existingSchema, desiredSchema);

  if (!changes.hasChanges) {
    // No changes, use current version
    return { version: currentVersion, changes: null, needsUpgrade: false };
  }

  // Process dangerous changes based on strategy
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
        // Keep as dangerous
        remainingDangerous.push(change);
      }
    } else {
      // Other dangerous changes remain dangerous
      remainingDangerous.push(change);
    }
  }

  changes.dangerous = remainingDangerous;

  if (changes.dangerous.length > 0) {
    // Has dangerous changes, throw error
    const dangerousDescriptions = changes.dangerous.map(c => {
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

  // Only safe changes, increment version
  return { version: currentVersion + 1, changes, needsUpgrade: true };
}
