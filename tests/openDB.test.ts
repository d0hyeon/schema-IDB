/**
 * openDB 테스트
 *
 * API 명세:
 * - openDB(config): 데이터베이스 연결 생성 (동기 반환)
 *   - config.name: 데이터베이스 이름
 *   - config.version: 버전 번호 (versionStrategy가 'explicit'일 때 필수)
 *   - config.versionStrategy: 'explicit' | 'auto' (기본: 'explicit')
 *   - config.stores: 스토어 정의 배열
 *   - config.onBlocked: 블로킹 시 콜백
 *   - config.onVersionChange: 버전 변경 시 콜백
 *
 * 반환값 (SchemaDatabase):
 * - name: 데이터베이스 이름
 * - version: 버전 번호
 * - raw: 원시 IDBDatabase 인스턴스
 * - ready: 초기화 완료 여부 (boolean)
 * - waitForReady(): 초기화 완료까지 대기 (Promise)
 * - close(): 연결 닫기
 * - startTransaction(storeNames, options): 트랜잭션 시작
 * - [storeName]: 스토어 접근자 (동적 프로퍼티)
 *
 * Lazy Initialization:
 * - openDB()는 즉시 동기적으로 반환됨
 * - 실제 IndexedDB 초기화는 비동기로 진행됨
 * - 스토어 작업은 자동으로 ready 상태를 기다림
 */
import { describe, it, expect, vi } from 'vitest';
import { openDB } from '../src/createSchemaDB.js';
import { defineStore } from '../src/schema.js';
import { field } from '../src/field.js';

describe('openDB', () => {
  describe('기본 데이터베이스 생성', () => {
    it('데이터베이스를 생성할 수 있어야 함', async () => {
      const usersStore = defineStore('users', {
        id: field.string().primaryKey(),
        name: field.string(),
      });

      const db = openDB({
        name: 'test-db',
        version: 1,
        stores: [usersStore] as const,
      });

      await db.waitForReady();

      expect(db.name).toBe('test-db');
      expect(db.version).toBe(1);
      expect(db.ready).toBe(true);

      db.close();
    });

    it('여러 스토어를 가진 데이터베이스를 생성할 수 있어야 함', async () => {
      const usersStore = defineStore('users', {
        id: field.string().primaryKey(),
        name: field.string(),
      });

      const postsStore = defineStore('posts', {
        id: field.string().primaryKey(),
        title: field.string(),
        authorId: field.string(),
      });

      const db = openDB({
        name: 'multi-store-db',
        version: 1,
        stores: [usersStore, postsStore] as const,
      });

      await db.waitForReady();

      expect(db.raw.objectStoreNames.contains('users')).toBe(true);
      expect(db.raw.objectStoreNames.contains('posts')).toBe(true);

      db.close();
    });
  });

  describe('동기 반환 (Lazy Initialization)', () => {
    it('openDB()는 즉시 동기적으로 반환되어야 함', () => {
      const usersStore = defineStore('users', {
        id: field.string().primaryKey(),
      });

      const db = openDB({
        name: 'sync-return-db',
        version: 1,
        stores: [usersStore] as const,
      });

      // 반환 직후에는 ready가 false일 수 있음
      expect(db).toBeDefined();
      expect(db.name).toBe('sync-return-db');

      db.close();
    });

    it('waitForReady()가 초기화 완료를 기다려야 함', async () => {
      const usersStore = defineStore('users', {
        id: field.string().primaryKey(),
      });

      const db = openDB({
        name: 'wait-ready-db',
        version: 1,
        stores: [usersStore] as const,
      });

      // waitForReady() 호출 전에는 ready가 false일 수 있음
      await db.waitForReady();

      expect(db.ready).toBe(true);
      expect(db.version).toBe(1);

      db.close();
    });

    it('스토어 작업은 자동으로 ready를 기다려야 함', async () => {
      const usersStore = defineStore('users', {
        id: field.string().primaryKey(),
        name: field.string(),
      });

      const db = openDB({
        name: 'auto-wait-db',
        version: 1,
        stores: [usersStore] as const,
      });

      // waitForReady() 없이 바로 작업 실행 - 자동으로 기다림
      const key = await db.users.put({ id: 'u1', name: 'Test' });

      expect(key).toBe('u1');
      expect(db.ready).toBe(true);

      const user = await db.users.get('u1');
      expect(user?.name).toBe('Test');

      db.close();
    });
  });

  describe('스토어 접근자', () => {
    it('스토어 이름으로 접근자에 접근할 수 있어야 함', async () => {
      const usersStore = defineStore('users', {
        id: field.string().primaryKey(),
        name: field.string(),
      });

      const db = openDB({
        name: 'store-accessor-db',
        version: 1,
        stores: [usersStore] as const,
      });

      await db.waitForReady();

      expect(db.users).toBeDefined();
      expect(typeof db.users.get).toBe('function');
      expect(typeof db.users.put).toBe('function');
      expect(typeof db.users.delete).toBe('function');

      db.close();
    });
  });

  describe('버전 전략', () => {
    it('explicit 전략에서 버전 없이 호출하면 에러가 발생해야 함', async () => {
      const usersStore = defineStore('users', {
        id: field.string().primaryKey(),
      });

      const db = openDB({
        name: 'no-version-db',
        versionStrategy: 'explicit',
        stores: [usersStore] as const,
      } as never);

      await expect(db.waitForReady()).rejects.toThrow('Version is required');

      db.close();
    });

    it('auto 전략에서는 버전이 자동으로 결정되어야 함', async () => {
      const usersStore = defineStore('users', {
        id: field.string().primaryKey(),
        name: field.string(),
      });

      const db = openDB({
        name: 'auto-version-db',
        versionStrategy: 'auto',
        stores: [usersStore] as const,
      });

      await db.waitForReady();

      expect(db.version).toBeGreaterThanOrEqual(1);

      db.close();
    });
  });

  describe('raw 접근', () => {
    it('raw로 원시 IDBDatabase에 접근할 수 있어야 함', async () => {
      const usersStore = defineStore('users', {
        id: field.string().primaryKey(),
      });

      const db = openDB({
        name: 'raw-access-db',
        version: 1,
        stores: [usersStore] as const,
      });

      await db.waitForReady();

      expect(db.raw).toBeDefined();
      expect(db.raw.name).toBe('raw-access-db');
      expect(db.raw.objectStoreNames.contains('users')).toBe(true);

      db.close();
    });

    it('ready 전에 raw에 접근하면 에러가 발생해야 함', () => {
      const usersStore = defineStore('users', {
        id: field.string().primaryKey(),
      });

      const db = openDB({
        name: 'raw-before-ready-db',
        version: 1,
        stores: [usersStore] as const,
      });

      // ready 전에 raw 접근 시도
      expect(() => db.raw).toThrow();

      db.close();
    });
  });

  describe('close()', () => {
    it('close()로 연결을 닫을 수 있어야 함', async () => {
      const usersStore = defineStore('users', {
        id: field.string().primaryKey(),
      });

      const db = openDB({
        name: 'close-db',
        version: 1,
        stores: [usersStore] as const,
      });

      await db.waitForReady();
      db.close();

      // 닫은 후에는 작업이 실패해야 함
      // (fake-indexeddb에서는 닫힌 DB에 대한 작업이 실패함)
    });
  });

  describe('유효성 검사', () => {
    it('중복된 스토어 이름이 있으면 에러를 던져야 함', () => {
      const store1 = defineStore('users', {
        id: field.string().primaryKey(),
      });

      const store2 = defineStore('users', {
        id: field.number().primaryKey(),
      });

      expect(() => {
        openDB({
          name: 'duplicate-store-db',
          version: 1,
          stores: [store1, store2] as const,
        });
      }).toThrow('Duplicate store name');
    });
  });

  describe('인덱스 생성', () => {
    it('스토어의 인덱스가 올바르게 생성되어야 함', async () => {
      const usersStore = defineStore('users', {
        id: field.string().primaryKey(),
        email: field.string().index({ unique: true }),
        name: field.string().index(),
        age: field.number(),
      });

      const db = openDB({
        name: 'index-db',
        version: 1,
        stores: [usersStore] as const,
      });

      await db.waitForReady();

      const tx = db.raw.transaction('users', 'readonly');
      const store = tx.objectStore('users');

      expect(store.indexNames.contains('email')).toBe(true);
      expect(store.indexNames.contains('name')).toBe(true);
      expect(store.indexNames.contains('age')).toBe(false);

      const emailIndex = store.index('email');
      expect(emailIndex.unique).toBe(true);

      db.close();
    });
  });

  describe('기본값 적용', () => {
    it('조회 시 기본값이 적용되어야 함', async () => {
      const usersStore = defineStore('users', {
        id: field.string().primaryKey(),
        name: field.string(),
        age: field.number().default(0),
        active: field.boolean().default(true),
      });

      const db = openDB({
        name: 'default-value-db',
        version: 1,
        stores: [usersStore] as const,
      });

      await db.waitForReady();

      // 기본값 없이 저장
      await db.users.put({ id: 'u1', name: 'Test' } as never);

      // 조회 시 기본값이 적용됨
      const user = await db.users.get('u1');

      expect(user?.name).toBe('Test');
      expect(user?.age).toBe(0);
      expect(user?.active).toBe(true);

      db.close();
    });
  });

  describe('removedStoreStrategy', () => {
    it('기본값(error)일 때 스토어 삭제 시 에러가 발생해야 함', async () => {
      const usersStore = defineStore('users', {
        id: field.string().primaryKey(),
      });

      const postsStore = defineStore('posts', {
        id: field.string().primaryKey(),
        title: field.string(),
      });

      // 두 스토어로 DB 생성
      const db1 = openDB({
        name: 'removed-store-error-db',
        versionStrategy: 'auto',
        stores: [usersStore, postsStore] as const,
      });

      await db1.waitForReady();
      await db1.posts.put({ id: 'p1', title: 'Test' });
      db1.close();

      // posts 스토어 없이 다시 열기 - 에러 발생해야 함
      await expect(async () => {
        const db2 = openDB({
          name: 'removed-store-error-db',
          versionStrategy: 'auto',
          stores: [usersStore] as const,
        });
        await db2.waitForReady();
      }).rejects.toThrow(/would be deleted/);
    });

    it('preserve일 때 스토어가 __storeName_deleted_v{version}__로 리네이밍되어야 함', async () => {
      const usersStore = defineStore('users', {
        id: field.string().primaryKey(),
      });

      const postsStore = defineStore('posts', {
        id: field.string().primaryKey(),
        title: field.string(),
      });

      // 두 스토어로 DB 생성 (version 1)
      const db1 = openDB({
        name: 'removed-store-preserve-db',
        versionStrategy: 'auto',
        stores: [usersStore, postsStore] as const,
      });

      await db1.waitForReady();
      await db1.posts.put({ id: 'p1', title: 'Test Post' });
      db1.close();

      // posts 스토어 없이 preserve로 다시 열기 (version 2)
      // 백업 스토어 이름에 기존 버전(1)이 포함됨
      const db2 = openDB({
        name: 'removed-store-preserve-db',
        versionStrategy: 'auto',
        removedStoreStrategy: 'preserve',
        stores: [usersStore] as const,
      });

      await db2.waitForReady();

      // 백업 스토어가 생성되었는지 확인 (버전 1에서 삭제되었으므로 v1)
      expect(db2.raw.objectStoreNames.contains('__posts_deleted_v1__')).toBe(true);
      expect(db2.raw.objectStoreNames.contains('posts')).toBe(false);

      // 백업 스토어의 데이터가 유지되었는지 확인
      const tx = db2.raw.transaction('__posts_deleted_v1__', 'readonly');
      const store = tx.objectStore('__posts_deleted_v1__');
      const request = store.get('p1');

      await new Promise<void>((resolve) => {
        request.onsuccess = () => {
          expect(request.result).toEqual({ id: 'p1', title: 'Test Post' });
          resolve();
        };
      });

      db2.close();
    });

    it('같은 스토어를 여러 번 삭제/재생성해도 백업 충돌이 없어야 함', async () => {
      const usersStore = defineStore('users', {
        id: field.string().primaryKey(),
      });

      const postsStore = defineStore('posts', {
        id: field.string().primaryKey(),
        title: field.string(),
      });

      // 1. 두 스토어로 DB 생성 (version 1)
      const db1 = openDB({
        name: 'removed-store-collision-db',
        versionStrategy: 'auto',
        stores: [usersStore, postsStore] as const,
      });

      await db1.waitForReady();
      await db1.posts.put({ id: 'p1', title: 'Post v1' });
      db1.close();

      // 2. posts 스토어 삭제 (version 2) - __posts_deleted_v1__ 생성
      const db2 = openDB({
        name: 'removed-store-collision-db',
        versionStrategy: 'auto',
        removedStoreStrategy: 'preserve',
        stores: [usersStore] as const,
      });

      await db2.waitForReady();
      expect(db2.raw.objectStoreNames.contains('__posts_deleted_v1__')).toBe(true);
      db2.close();

      // 3. posts 스토어 다시 추가 (version 3)
      const db3 = openDB({
        name: 'removed-store-collision-db',
        versionStrategy: 'auto',
        stores: [usersStore, postsStore] as const,
      });

      await db3.waitForReady();
      await db3.posts.put({ id: 'p2', title: 'Post v3' });
      expect(db3.raw.objectStoreNames.contains('posts')).toBe(true);
      expect(db3.raw.objectStoreNames.contains('__posts_deleted_v1__')).toBe(true);
      db3.close();

      // 4. posts 스토어 다시 삭제 (version 4) - __posts_deleted_v3__ 생성 (충돌 없음)
      const db4 = openDB({
        name: 'removed-store-collision-db',
        versionStrategy: 'auto',
        removedStoreStrategy: 'preserve',
        stores: [usersStore] as const,
      });

      await db4.waitForReady();
      // 두 백업 스토어가 모두 존재해야 함
      expect(db4.raw.objectStoreNames.contains('__posts_deleted_v1__')).toBe(true);
      expect(db4.raw.objectStoreNames.contains('__posts_deleted_v3__')).toBe(true);
      expect(db4.raw.objectStoreNames.contains('posts')).toBe(false);

      // 각 백업의 데이터가 올바른지 확인
      const tx1 = db4.raw.transaction('__posts_deleted_v1__', 'readonly');
      const store1 = tx1.objectStore('__posts_deleted_v1__');
      const req1 = store1.get('p1');
      await new Promise<void>((resolve) => {
        req1.onsuccess = () => {
          expect(req1.result).toEqual({ id: 'p1', title: 'Post v1' });
          resolve();
        };
      });

      const tx2 = db4.raw.transaction('__posts_deleted_v3__', 'readonly');
      const store2 = tx2.objectStore('__posts_deleted_v3__');
      const req2 = store2.get('p2');
      await new Promise<void>((resolve) => {
        req2.onsuccess = () => {
          expect(req2.result).toEqual({ id: 'p2', title: 'Post v3' });
          resolve();
        };
      });

      db4.close();
    });

    it('explicit 모드에서 removedStoreStrategy: preserve가 동작해야 함', async () => {
      const usersStore = defineStore('users', {
        id: field.string().primaryKey(),
      });

      const postsStore = defineStore('posts', {
        id: field.string().primaryKey(),
        title: field.string(),
      });

      // 두 스토어로 DB 생성 (version 1)
      const db1 = openDB({
        name: 'explicit-preserve-db',
        version: 1,
        versionStrategy: 'explicit',
        stores: [usersStore, postsStore] as const,
      });

      await db1.waitForReady();
      await db1.posts.put({ id: 'p1', title: 'Test Post' });
      db1.close();

      // posts 스토어 없이 preserve로, 버전 업해서 다시 열기 (version 2)
      const db2 = openDB({
        name: 'explicit-preserve-db',
        version: 2,
        versionStrategy: 'explicit',
        removedStoreStrategy: 'preserve',
        stores: [usersStore] as const,
      });

      await db2.waitForReady();

      // 백업 스토어가 생성되었는지 확인 (버전 1에서 삭제됨)
      expect(db2.raw.objectStoreNames.contains('__posts_deleted_v1__')).toBe(true);
      expect(db2.raw.objectStoreNames.contains('posts')).toBe(false);

      // 백업 스토어의 데이터가 유지되었는지 확인
      const tx = db2.raw.transaction('__posts_deleted_v1__', 'readonly');
      const store = tx.objectStore('__posts_deleted_v1__');
      const request = store.get('p1');

      await new Promise<void>((resolve) => {
        request.onsuccess = () => {
          expect(request.result).toEqual({ id: 'p1', title: 'Test Post' });
          resolve();
        };
      });

      db2.close();
    });

    it('explicit 모드에서 버전을 올리지 않으면 스키마 변경이 적용되지 않아야 함', async () => {
      const usersStore = defineStore('users', {
        id: field.string().primaryKey(),
      });

      const postsStore = defineStore('posts', {
        id: field.string().primaryKey(),
        title: field.string(),
      });

      // 두 스토어로 DB 생성 (version 1)
      const db1 = openDB({
        name: 'explicit-no-bump-db',
        version: 1,
        versionStrategy: 'explicit',
        stores: [usersStore, postsStore] as const,
      });

      await db1.waitForReady();
      await db1.posts.put({ id: 'p1', title: 'Test Post' });
      db1.close();

      // posts 스토어 없이, 같은 버전(1)으로 다시 열기 - 스키마 변경 적용되지 않음
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const db2 = openDB({
        name: 'explicit-no-bump-db',
        version: 1,
        versionStrategy: 'explicit',
        removedStoreStrategy: 'preserve',
        stores: [usersStore] as const,
      });

      await db2.waitForReady();

      // 경고 메시지가 출력되었는지 확인
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Schema changes detected but version not bumped')
      );

      // posts 스토어가 여전히 존재해야 함 (스키마 변경 적용 안됨)
      expect(db2.raw.objectStoreNames.contains('posts')).toBe(true);
      expect(db2.raw.objectStoreNames.contains('__posts_deleted_v1__')).toBe(false);

      warnSpy.mockRestore();
      db2.close();
    });
  });
});
