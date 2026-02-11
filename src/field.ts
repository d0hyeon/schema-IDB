/**
 * Field builder for Drizzle/Zod-style schema definition
 */

// ============================================================================
// Index Options
// ============================================================================

export interface IndexOptions {
  unique?: boolean;
  multiEntry?: boolean;
}

export interface AutoIncrementOptions {
  autoIncrement?: boolean;
}

// ============================================================================
// Type Builder (for nested types - no index/primaryKey)
// ============================================================================

export interface TypeDef<
  T = unknown,
  Optional extends boolean = false,
  HasDefault extends boolean = false
> {
  _type: T;
  _optional: Optional;
  _hasDefault: HasDefault;
  _default?: T;
}

export interface TypeBuilder<
  T,
  Optional extends boolean = false,
  HasDefault extends boolean = false
> {
  _def: TypeDef<T, Optional, HasDefault>;

  /** Mark as optional */
  optional(): TypeBuilder<T, true, HasDefault>;

  /** Set default value */
  default(value: T): TypeBuilder<T, Optional, true>;

  /** Convert to array */
  array(): TypeBuilder<T[], Optional, HasDefault>;
}

function createTypeBuilder<T>(): TypeBuilder<T> {
  const def: TypeDef<T, false, false> = {
    _type: undefined as T,
    _optional: false,
    _hasDefault: false,
  };

  const builder: TypeBuilder<T> = {
    _def: def,

    optional() {
      return {
        ...this,
        _def: { ...this._def, _optional: true },
      } as unknown as TypeBuilder<T, true, false>;
    },

    default(value: T) {
      return {
        ...this,
        _def: { ...this._def, _hasDefault: true, _default: value },
      } as unknown as TypeBuilder<T, false, true>;
    },

    array() {
      return createTypeBuilder<T[]>() as unknown as TypeBuilder<T[], false, false>;
    },
  };

  return builder;
}

/** Type factory for nested objects/tuples */
export const type = {
  string: () => createTypeBuilder<string>(),
  number: () => createTypeBuilder<number>(),
  boolean: () => createTypeBuilder<boolean>(),
  date: () => createTypeBuilder<Date>(),
  custom: <T>() => createTypeBuilder<T>(),
};

export type TypeFactory = typeof type;

// ============================================================================
// Field Definition Types
// ============================================================================

export interface FieldDef<
  T = unknown,
  Optional extends boolean = false,
  HasDefault extends boolean = false,
  IsIndexed extends boolean = false,
  AutoIncrement extends boolean = false,
  IsPrimaryKey extends boolean = false
> {
  _type: T;
  _optional: Optional;
  _hasDefault: HasDefault;
  _isIndexed: IsIndexed;
  _autoIncrement: AutoIncrement;
  _isPrimaryKey: IsPrimaryKey;
  _default?: T;
  _indexOptions?: IndexOptions;
}

// ============================================================================
// Field Builder Interface
// ============================================================================

/** Base field builder interface */
interface BaseFieldBuilder<
  T,
  Optional extends boolean = false,
  HasDefault extends boolean = false,
  IsIndexed extends boolean = false,
  AutoIncrement extends boolean = false,
  IsPrimaryKey extends boolean = false
> {
  _def: FieldDef<T, Optional, HasDefault, IsIndexed, AutoIncrement, IsPrimaryKey>;

  /** Mark field as optional (can be undefined) */
  optional(): FieldBuilder<T, true, HasDefault, IsIndexed, AutoIncrement, IsPrimaryKey>;

  /** Set default value */
  default(value: T): FieldBuilder<T, Optional, true, IsIndexed, AutoIncrement, IsPrimaryKey>;

  /** Create an index on this field */
  index(options?: IndexOptions): FieldBuilder<T, Optional, HasDefault, true, AutoIncrement, IsPrimaryKey>;

  /** Convert to array type */
  array(): FieldBuilder<T[], Optional, HasDefault, IsIndexed, false, false>;
}

/** Field builder for number type (with autoIncrement support) */
export interface NumberFieldBuilder<
  Optional extends boolean = false,
  HasDefault extends boolean = false,
  IsIndexed extends boolean = false,
  AutoIncrement extends boolean = false,
  IsPrimaryKey extends boolean = false
> extends BaseFieldBuilder<number, Optional, HasDefault, IsIndexed, AutoIncrement, IsPrimaryKey> {
  /** Mark as primary key */
  
  primaryKey(): NumberFieldBuilder<Optional, HasDefault, IsIndexed, false, true>;

  /** Mark as primary key with autoIncrement: true (makes field optional in input) */
  primaryKey(options: { autoIncrement: true }): NumberFieldBuilder<true, HasDefault, IsIndexed, true, true>;

  /** Mark as primary key with autoIncrement: false (field remains required) */
  primaryKey(options: { autoIncrement: false }): NumberFieldBuilder<Optional, HasDefault, IsIndexed, false, true>;
}

/** Field builder for non-number types (no autoIncrement) */
export interface FieldBuilder<
  T,
  Optional extends boolean = false,
  HasDefault extends boolean = false,
  IsIndexed extends boolean = false,
  AutoIncrement extends boolean = false,
  IsPrimaryKey extends boolean = false
> extends BaseFieldBuilder<T, Optional, HasDefault, IsIndexed, AutoIncrement, IsPrimaryKey> {
  /** Mark as primary key */
  primaryKey(): FieldBuilder<T, Optional, HasDefault, IsIndexed, false, true>;
}

// ============================================================================
// Field Builder Implementation
// ============================================================================

function createFieldBuilder<T>(): FieldBuilder<T> {
  const def: FieldDef<T, false, false, false, false> = {
    _type: undefined as T,
    _optional: false,
    _hasDefault: false,
    _isIndexed: false,
    _autoIncrement: false,
    _isPrimaryKey: false,
  };

  const builder: FieldBuilder<T> = {
    _def: def,

    optional() {
      return {
        ...this,
        _def: { ...this._def, _optional: true },
      } as unknown as FieldBuilder<T, true, false, false, false>;
    },

    default(value: T) {
      return {
        ...this,
        _def: { ...this._def, _hasDefault: true, _default: value },
      } as unknown as FieldBuilder<T, false, true, false, false>;
    },

    primaryKey() {
      return {
        ...this,
        _def: { ...this._def, _isPrimaryKey: true },
      } as unknown as FieldBuilder<T, false, false, false, false, true>;
    },

    index(options?: IndexOptions) {
      return {
        ...this,
        _def: { ...this._def, _isIndexed: true, _indexOptions: options },
      } as unknown as FieldBuilder<T, false, false, true, false>;
    },

    array() {
      return createFieldBuilder<T[]>() as unknown as FieldBuilder<T[], false, false, false, false>;
    },
  };

  return builder;
}

function createNumberFieldBuilder(): NumberFieldBuilder {
  const def: FieldDef<number, false, false, false, false> = {
    _type: undefined as unknown as number,
    _optional: false,
    _hasDefault: false,
    _isIndexed: false,
    _autoIncrement: false,
    _isPrimaryKey: false,
  };

  const builder: NumberFieldBuilder = {
    _def: def,

    optional() {
      return {
        ...this,
        _def: { ...this._def, _optional: true },
      } as unknown as NumberFieldBuilder<true, false, false, false>;
    },

    default(value: number) {
      return {
        ...this,
        _def: { ...this._def, _hasDefault: true, _default: value },
      } as unknown as NumberFieldBuilder<false, true, false, false>;
    },

    primaryKey(options?: AutoIncrementOptions): any {
      const autoIncrement = options?.autoIncrement ?? false;
      return {
        ...this,
        _def: {
          ...this._def,
          _isPrimaryKey: true,
          _autoIncrement: autoIncrement,
          _optional: autoIncrement,
        },
      };
    },

    index(options?: IndexOptions) {
      return {
        ...this,
        _def: { ...this._def, _isIndexed: true, _indexOptions: options },
      } as unknown as NumberFieldBuilder<false, false, true, false>;
    },

    array() {
      return createFieldBuilder<number[]>() as unknown as FieldBuilder<number[], false, false, false, false>;
    },
  };

  return builder;
}

// ============================================================================
// Type Utilities
// ============================================================================

/**
 * Forces TypeScript to fully expand/resolve a type for better IDE display
 */
type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};

// ============================================================================
// Infer Object Schema Type
// ============================================================================

type ObjectSchema = Record<string, TypeBuilder<unknown, boolean, boolean>>;

// Required keys in object schema
type ObjectRequiredKeys<S extends ObjectSchema> = {
  [K in keyof S]: S[K] extends TypeBuilder<unknown, false, false> ? K : never;
}[keyof S];

// Optional keys in object schema
type ObjectOptionalKeys<S extends ObjectSchema> = Exclude<keyof S, ObjectRequiredKeys<S>>;

// Infer type from TypeBuilder
type InferTypeBuilderType<T> = T extends TypeBuilder<infer U, infer Optional, infer HasDefault>
  ? HasDefault extends true
    ? U
    : Optional extends true
      ? U | undefined
      : U
  : never;

type InferObjectType<S extends ObjectSchema> = Prettify<
  { [K in ObjectRequiredKeys<S>]: InferTypeBuilderType<S[K]> } &
  { [K in ObjectOptionalKeys<S>]?: InferTypeBuilderType<S[K]> }
>;

// ============================================================================
// Infer Tuple Type
// ============================================================================

type TupleSchema = readonly TypeBuilder<unknown, boolean, boolean>[];

type InferTupleType<T extends TupleSchema> = {
  [K in keyof T]: T[K] extends TypeBuilder<infer U, boolean, boolean> ? U : never;
};

// ============================================================================
// Field Factory
// ============================================================================

/**
 * Field type builders for schema definition
 *
 * @example
 * ```ts
 * const usersStore = defineStore('users', {
 *   id: field.string().primaryKey(),
 *   name: field.string().index(),
 *   email: field.string().index({ unique: true }),
 *   
 *   // Array (Zod style)
 *   tags: field.string().array(),
 *   
 *   // Object with schema
 *   address: field.object(t => ({
 *     detail: t.string(),
 *     post: t.string(),
 *     zipCode: t.number().optional(),
 *   })).optional().default({ detail: '', post: '' }),
 *   
 *   // Tuple
 *   coordinate: field.tuple(t => [t.number(), t.number()]),
 *   
 *   // Enum
 *   status: field.enum(['active', 'inactive'] as const),
 *   
 *   // Native Enum
 *   role: field.nativeEnum(UserRole),
 * });
 * ```
 */
export const field = {
  /** String field */
  string: () => createFieldBuilder<string>(),

  /** Number field (supports autoIncrement for primary key) */
  number: () => createNumberFieldBuilder(),

  /** Boolean field */
  boolean: () => createFieldBuilder<boolean>(),

  /** Date field */
  date: () => createFieldBuilder<Date>(),

  /**
   * Object field with schema definition
   * @example
   * field.object(t => ({
   *   name: t.string(),
   *   age: t.number().optional(),
   * }))
   */
  object: <S extends ObjectSchema>(
    schema: (t: TypeFactory) => S
  ): FieldBuilder<InferObjectType<S>> => {
    // Execute schema function to get the shape (for runtime validation if needed)
    const _shape = schema(type);
    return createFieldBuilder<InferObjectType<S>>();
  },

  /**
   * Tuple field
   * @example
   * field.tuple(t => [t.number(), t.number()])  // [number, number]
   */
  tuple: <T extends TupleSchema>(
    schema: (t: TypeFactory) => T
  ): FieldBuilder<InferTupleType<T>> => {
    const _shape = schema(type);
    return createFieldBuilder<InferTupleType<T>>();
  },

  /**
   * Enum field from string literals
   * @example
   * field.enum(['active', 'inactive', 'pending'] as const)
   */
  enum: <const T extends readonly string[]>(
    values: T
  ): FieldBuilder<T[number]> => {
    return createFieldBuilder<T[number]>();
  },

  /**
   * Native TypeScript enum
   * @example
   * enum Status { Active, Inactive }
   * field.nativeEnum(Status)
   */
  nativeEnum: <T extends Record<string, string | number>>(
    enumObj: T
  ): FieldBuilder<T[keyof T]> => {
    return createFieldBuilder<T[keyof T]>();
  },
};

// ============================================================================
// Schema Type Inference
// ============================================================================

/** Schema definition type */
export type StoreSchema = Record<string, FieldBuilder<unknown, boolean, boolean, boolean, boolean, boolean> | NumberFieldBuilder<boolean, boolean, boolean, boolean, boolean>>;

/** Extract required input keys (not optional, no default, not autoIncrement) */
type RequiredInputKeys<S extends StoreSchema> = {
  [K in keyof S]: S[K] extends { _def: { _optional: false; _hasDefault: false; _autoIncrement: false } } ? K : never;
}[keyof S];

/** Extract optional input keys (optional OR has default OR autoIncrement) */
type OptionalInputKeys<S extends StoreSchema> = Exclude<keyof S, RequiredInputKeys<S>>;

/**
 * Infer input type from schema (for put/add operations)
 */
export type InferInput<S extends StoreSchema> =
  { [K in RequiredInputKeys<S>]: S[K] extends { _def: { _type: infer T } } ? T : never } &
  { [K in OptionalInputKeys<S>]?: S[K] extends { _def: { _type: infer T } } ? T : never };

/**
 * Infer output field type
 */
type InferOutputField<F> =
  F extends { _def: { _type: infer T; _optional: infer Optional; _hasDefault: infer HasDefault; _autoIncrement: infer AutoInc } }
    ? HasDefault extends true
      ? T
      : AutoInc extends true
        ? T  // autoIncrement fields are always present in output
        : Optional extends true
          ? T | undefined
          : T
    : never;

/**
 * Infer output type from schema (for get operations)
 */
export type InferOutput<S extends StoreSchema> = Prettify<{
  [K in keyof S]: InferOutputField<S[K]>;
}>;

/**
 * Extract primary key field name from schema
 */
export type PrimaryKeyField<S extends StoreSchema> = {
  [K in keyof S]: S[K] extends { _def: { _isPrimaryKey: true } } ? K : never;
}[keyof S];

/**
 * Extract primary key type from schema
 */
export type PrimaryKeyType<S extends StoreSchema> =
  S[PrimaryKeyField<S>] extends { _def: { _type: infer T } } ? T : never;

/**
 * Check if schema has autoIncrement primary key
 */
export type HasAutoIncrement<S extends StoreSchema> =
  S[PrimaryKeyField<S>] extends { _def: { _autoIncrement: true } } ? true : false;

// ============================================================================
// Index Field Extraction
// ============================================================================

/**
 * Extract field names that have indexes
 */
export type IndexedFields<S extends StoreSchema> = {
  [K in keyof S]: S[K] extends { _def: { _isIndexed: true } } ? K : never;
}[keyof S];

/**
 * Map of index field names to their types
 */
export type IndexFieldTypes<S extends StoreSchema> = {
  [K in IndexedFields<S>]: S[K] extends { _def: { _type: infer T } } ? T : never;
};

/**
 * Get field type by field name
 */
export type FieldType<S extends StoreSchema, K extends keyof S> =
  S[K] extends { _def: { _type: infer T } } ? T : never;

// ============================================================================
// Store Type Inference
// ============================================================================

/**
 * Infer data type from store definition
 * @example
 * const usersStore = defineStore('users', { ... });
 * type User = InferStore<typeof usersStore>;
 */
export type InferStore<TStore> = TStore extends { schema: infer S }
  ? S extends StoreSchema
    ? InferOutput<S>
    : never
  : never;

/**
 * Type constraint for type-first store definitions
 * Use with `satisfies` to validate schema against a pre-defined type
 *
 * @example
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
 */
export interface DefinedStore<T> {
  _output: T;
  name: string;
  schema: StoreSchema;
  keyPath: string;
  autoIncrement: boolean;
  indexes: readonly unknown[];
  migrations: readonly unknown[];
  defaults: Partial<T>;
}
