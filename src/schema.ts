import type {
  StoreSchema,
  InferInput,
  InferOutput,
  PrimaryKeyField,
  PrimaryKeyType,
  FieldBuilder,
} from './field.js';
import type { StoreDefinition, IndexDefinition, Migration, MigrationFn } from './types.js';

// ============================================================================
// Store Options
// ============================================================================

export interface DefineStoreOptions {
  migrations?: Migration[];
}

// ============================================================================
// Builder Interface for Chaining
// ============================================================================

export interface SchemaStoreBuilder<
  S extends StoreSchema,
  TName extends string = string
> extends SchemaStoreDefinition<S, TName> {
  /**
   * Add a migration to this store
   *
   * Migrations are identified by name and sorted alphabetically for execution.
   * Use naming convention like '001-initial', '002-add-email-index'.
   *
   * @example
   * ```ts
   * const usersStore = defineStore('users', {
   *   id: field.string().primaryKey(),
   *   name: field.string(),
   * })
   *   .addMigration('001-seed-admin', (db, tx) => {
   *     const store = tx.objectStore('users');
   *     store.put({ id: 'admin', name: 'Admin' });
   *   })
   *   .addMigration('002-add-default-users', (db, tx) => {
   *     const store = tx.objectStore('users');
   *     store.put({ id: 'guest', name: 'Guest' });
   *   });
   * ```
   */
  addMigration(name: string, up: MigrationFn): SchemaStoreBuilder<S, TName>;
}

// ============================================================================
// Store Definition Result
// ============================================================================

export interface SchemaStoreDefinition<
  S extends StoreSchema,
  TName extends string = string
> {
  name: TName;
  schema: S;
  keyPath: PrimaryKeyField<S>;
  indexes: IndexDefinition[];
  migrations: Migration[];
  defaults: Partial<InferOutput<S>>;

  // Phantom types for inference
  _input: InferInput<S>;
  _output: InferOutput<S>;
  _keyType: PrimaryKeyType<S>;
}

// ============================================================================
// Schema Parser
// ============================================================================

function parseSchema<S extends StoreSchema>(schema: S): {
  keyPath: string | undefined;
  indexes: IndexDefinition[];
  defaults: Record<string, unknown>;
} {
  let keyPath: string | undefined;
  const indexes: IndexDefinition[] = [];
  const defaults: Record<string, unknown> = {};

  for (const [fieldName, fieldBuilder] of Object.entries(schema)) {
    const def = (fieldBuilder as FieldBuilder<unknown, boolean, boolean, boolean>)._def;

    // Primary key
    if (def._primaryKey) {
      if (keyPath) {
        throw new Error(`Multiple primary keys defined: "${keyPath}" and "${fieldName}"`);
      }
      keyPath = fieldName;
    }

    // Index
    if (def._isIndexed) {
      indexes.push({
        name: fieldName,
        keyPath: fieldName,
        unique: def._indexOptions?.unique,
        multiEntry: def._indexOptions?.multiEntry,
      });
    }

    // Default value
    if (def._hasDefault && def._default !== undefined) {
      defaults[fieldName] = def._default;
    }
  }

  return { keyPath, indexes, defaults };
}

// ============================================================================
// defineStore Function
// ============================================================================

/**
 * Create a builder object with addMigration chaining support
 */
function createStoreBuilder<S extends StoreSchema, TName extends string>(
  definition: SchemaStoreDefinition<S, TName>
): SchemaStoreBuilder<S, TName> {
  const builder: SchemaStoreBuilder<S, TName> = {
    ...definition,
    addMigration(migrationName: string, up: MigrationFn): SchemaStoreBuilder<S, TName> {
      // Validate migration name
      if (!migrationName || typeof migrationName !== 'string') {
        throw new Error(`Migration name is required and must be a string in store "${definition.name}"`);
      }

      // Check for duplicate migration names
      const existingNames = new Set(definition.migrations.map(m => m.name));
      if (existingNames.has(migrationName)) {
        throw new Error(`Duplicate migration name "${migrationName}" in store "${definition.name}"`);
      }

      // Create new migrations array with the added migration
      const newMigrations = [...definition.migrations, { name: migrationName, up }]
        .sort((a, b) => a.name.localeCompare(b.name));

      // Return new builder with updated migrations
      return createStoreBuilder({
        ...definition,
        migrations: newMigrations,
      });
    },
  };

  return builder;
}

/**
 * Define an ObjectStore with schema
 *
 * @example Schema-first (infer type from schema)
 * ```ts
 * const usersStore = defineStore('users', {
 *   id: field.string().primaryKey(),
 *   name: field.string(),
 *   age: field.number().optional(),
 * });
 * type User = InferStore<typeof usersStore>;
 * ```
 *
 * @example Type-first (validate schema against type)
 * ```ts
 * interface User {
 *   id: string;
 *   name: string;
 *   age?: number;
 * }
 *
 * const usersStore = defineStore('users', {
 *   id: field.string().primaryKey(),
 *   name: field.string(),
 *   age: field.number().optional(),
 * }) satisfies DefinedStore<User>;
 * ```
 */
export function defineStore<const TName extends string, S extends StoreSchema>(
  name: TName,
  schema: S,
  options: DefineStoreOptions = {}
): SchemaStoreBuilder<S, TName> {
  const { migrations = [] } = options;

  // Validate store name
  if (!name || typeof name !== 'string') {
    throw new Error('Store name is required and must be a string');
  }

  // Parse schema
  const { keyPath, indexes, defaults } = parseSchema(schema);

  // Validate primary key
  if (!keyPath) {
    throw new Error(`Store "${name}" must have a primary key. Use field.xxx().primaryKey()`);
  }

  // Validate migrations
  const migrationNames = new Set<string>();
  for (const migration of migrations) {
    if (!migration.name || typeof migration.name !== 'string') {
      throw new Error(
        `Invalid migration name in store "${name}": must be a non-empty string`
      );
    }
    if (migrationNames.has(migration.name)) {
      throw new Error(
        `Duplicate migration name "${migration.name}" in store "${name}"`
      );
    }
    migrationNames.add(migration.name);
  }

  const definition: SchemaStoreDefinition<S, TName> = {
    name,
    schema,
    keyPath: keyPath as PrimaryKeyField<S>,
    indexes,
    migrations: [...migrations].sort((a, b) => a.name.localeCompare(b.name)),
    defaults: defaults as Partial<InferOutput<S>>,
    _input: {} as InferInput<S>,
    _output: {} as InferOutput<S>,
    _keyType: {} as PrimaryKeyType<S>,
  };

  return createStoreBuilder(definition);
}

// ============================================================================
// Type Conversion for openDB
// ============================================================================

/**
 * Convert SchemaStoreDefinition to StoreDefinition for internal use
 */
export function toStoreDefinition<S extends StoreSchema, TName extends string>(
  store: SchemaStoreDefinition<S, TName>
): StoreDefinition<InferOutput<S>, PrimaryKeyType<S>, TName> {
  return {
    name: store.name,
    keyPath: store.keyPath as string,
    autoIncrement: false,
    indexes: store.indexes,
    migrations: store.migrations,
    _schema: {} as InferOutput<S>,
    _keyType: {} as PrimaryKeyType<S>,
  };
}
