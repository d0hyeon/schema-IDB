/**
 * Transaction 테스트
 *
 * API 명세:
 *
 * db.startTransaction(storeNames, options?):
 * - storeNames: 트랜잭션에 포함할 스토어 이름 배열
 * - options.mode: 'readonly' | 'readwrite' (기본: 'readonly')
 * - options.durability: 'default' | 'strict' | 'relaxed' (기본: 'default')
 *
 * Transaction 객체:
 * - [storeName]: TransactionStoreAccessor (동적 프로퍼티)
 * - commit(): Promise<void> - 트랜잭션 커밋
 * - abort(): void - 트랜잭션 중단
 *
 * TransactionStoreAccessor (동기 메서드):
 * - get(key): void - 조회 요청 큐잉
 * - getAll(): void - 전체 조회 요청 큐잉
 * - getAllByIndex(indexName, query?): void - 인덱스 조회 요청 큐잉
 * - put(value, key?): void - 추가/수정 요청 큐잉
 * - add(value, key?): void - 추가 요청 큐잉
 * - delete(key): void - 삭제 요청 큐잉
 * - clear(): void - 전체 삭제 요청 큐잉
 *
 * 특징:
 * - 모든 스토어 작업은 동기적 (await 없이 큐잉)
 * - commit() 호출 시 모든 작업이 원자적으로 실행
 * - abort() 호출 시 모든 작업이 롤백
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDB, type SchemaDatabase } from '../src/createSchemaDB.js';
import { defineStore } from '../src/schema.js';
import { field } from '../src/field.js';

// 테스트용 스토어 정의
const accountsStore = defineStore('accounts', {
  id: field.string().primaryKey(),
  name: field.string(),
  balance: field.number().default(0),
});

const transactionsStore = defineStore('transactions', {
  id: field.string().primaryKey(),
  fromId: field.string().index(),
  toId: field.string().index(),
  amount: field.number(),
  timestamp: field.date(),
});

type TestDB = SchemaDatabase<readonly [
  typeof accountsStore,
  typeof transactionsStore,
]>;

describe('Transaction', () => {
  let db: TestDB;
  let dbCounter = 0;

  beforeEach(async () => {
    const dbName = `tx-test-${Date.now()}-${dbCounter++}`;
    db = openDB({
      name: dbName,
      version: 1,
      stores: [accountsStore, transactionsStore] as const,
    });
    await db.waitForReady();

    // 테스트 데이터 초기화
    await db.accounts.put({ id: 'acc1', name: 'Account 1', balance: 1000 });
    await db.accounts.put({ id: 'acc2', name: 'Account 2', balance: 500 });
  });

  afterEach(() => {
    db?.close();
  });

  describe('startTransaction()', () => {
    it('트랜잭션을 시작할 수 있어야 함', async () => {
      const tx = db.startTransaction(['accounts'], { mode: 'readonly' });

      expect(tx).toBeDefined();
      expect(typeof tx.commit).toBe('function');
      expect(typeof tx.abort).toBe('function');

      await tx.commit();
    });

    it('여러 스토어를 포함하는 트랜잭션을 시작할 수 있어야 함', async () => {
      const tx = db.startTransaction(['accounts', 'transactions'], {
        mode: 'readwrite',
      });

      expect(tx.accounts).toBeDefined();
      expect(tx.transactions).toBeDefined();

      await tx.commit();
    });
  });

  describe('트랜잭션 작업', () => {
    it('트랜잭션 내에서 put 작업을 수행할 수 있어야 함', async () => {
      const tx = db.startTransaction(['accounts'], { mode: 'readwrite' });

      tx.accounts.put({ id: 'acc3', name: 'Account 3', balance: 200 });

      await tx.commit();

      const account = await db.accounts.get('acc3');
      expect(account?.name).toBe('Account 3');
      expect(account?.balance).toBe(200);
    });

    it('트랜잭션 내에서 여러 작업을 수행할 수 있어야 함', async () => {
      const tx = db.startTransaction(['accounts'], { mode: 'readwrite' });

      tx.accounts.put({ id: 'acc3', name: 'Account 3', balance: 300 });
      tx.accounts.put({ id: 'acc4', name: 'Account 4', balance: 400 });
      tx.accounts.delete('acc1');

      await tx.commit();

      const acc3 = await db.accounts.get('acc3');
      const acc4 = await db.accounts.get('acc4');
      const acc1 = await db.accounts.get('acc1');

      expect(acc3?.name).toBe('Account 3');
      expect(acc4?.name).toBe('Account 4');
      expect(acc1).toBeUndefined();
    });

    it('여러 스토어에 걸친 작업을 수행할 수 있어야 함', async () => {
      const tx = db.startTransaction(['accounts', 'transactions'], {
        mode: 'readwrite',
      });

      // 계좌 잔액 업데이트
      tx.accounts.put({ id: 'acc1', name: 'Account 1', balance: 900 });
      tx.accounts.put({ id: 'acc2', name: 'Account 2', balance: 600 });

      // 거래 기록 추가
      tx.transactions.put({
        id: 'tx1',
        fromId: 'acc1',
        toId: 'acc2',
        amount: 100,
        timestamp: new Date(),
      });

      await tx.commit();

      const acc1 = await db.accounts.get('acc1');
      const acc2 = await db.accounts.get('acc2');
      const txRecord = await db.transactions.get('tx1');

      expect(acc1?.balance).toBe(900);
      expect(acc2?.balance).toBe(600);
      expect(txRecord?.amount).toBe(100);
    });
  });

  describe('commit()', () => {
    it('commit()은 모든 작업을 원자적으로 완료해야 함', async () => {
      const tx = db.startTransaction(['accounts'], { mode: 'readwrite' });

      tx.accounts.put({ id: 'new1', name: 'New 1', balance: 100 });
      tx.accounts.put({ id: 'new2', name: 'New 2', balance: 200 });

      await tx.commit();

      const count = await db.accounts.count();
      expect(count).toBe(4); // 기존 2개 + 새로 2개
    });
  });

  describe('abort()', () => {
    it('abort()는 모든 작업을 롤백해야 함', async () => {
      const tx = db.startTransaction(['accounts'], { mode: 'readwrite' });

      tx.accounts.put({ id: 'temp', name: 'Temporary', balance: 999 });
      tx.accounts.delete('acc1');

      tx.abort();

      // abort() 후에는 commit()이 실패해야 함
      await expect(tx.commit()).rejects.toThrow();

      // 데이터가 롤백되어야 함
      const temp = await db.accounts.get('temp');
      const acc1 = await db.accounts.get('acc1');

      expect(temp).toBeUndefined();
      expect(acc1).toBeDefined();
    });
  });

  describe('clear()', () => {
    it('트랜잭션 내에서 clear를 수행할 수 있어야 함', async () => {
      const tx = db.startTransaction(['accounts'], { mode: 'readwrite' });

      tx.accounts.clear();

      await tx.commit();

      const count = await db.accounts.count();
      expect(count).toBe(0);
    });
  });

  describe('복합 시나리오', () => {
    it('이체 시나리오: 여러 스토어에 걸친 원자적 작업', async () => {
      const fromAccount = await db.accounts.get('acc1');
      const toAccount = await db.accounts.get('acc2');

      if (!fromAccount || !toAccount) {
        throw new Error('계좌가 존재하지 않음');
      }

      const transferAmount = 100;

      const tx = db.startTransaction(['accounts', 'transactions'], {
        mode: 'readwrite',
      });

      // 이체 처리
      tx.accounts.put({
        id: fromAccount.id,
        name: fromAccount.name,
        balance: fromAccount.balance - transferAmount,
      });

      tx.accounts.put({
        id: toAccount.id,
        name: toAccount.name,
        balance: toAccount.balance + transferAmount,
      });

      tx.transactions.put({
        id: `tx-${Date.now()}`,
        fromId: fromAccount.id,
        toId: toAccount.id,
        amount: transferAmount,
        timestamp: new Date(),
      });

      await tx.commit();

      // 결과 확인
      const updatedFrom = await db.accounts.get('acc1');
      const updatedTo = await db.accounts.get('acc2');

      expect(updatedFrom?.balance).toBe(900); // 1000 - 100
      expect(updatedTo?.balance).toBe(600); // 500 + 100
    });

    it('배치 삽입 시나리오', async () => {
      const tx = db.startTransaction(['accounts'], { mode: 'readwrite' });

      // 여러 계좌 일괄 생성
      for (let i = 3; i <= 10; i++) {
        tx.accounts.put({
          id: `acc${i}`,
          name: `Account ${i}`,
          balance: i * 100,
        });
      }

      await tx.commit();

      const count = await db.accounts.count();
      expect(count).toBe(10); // 기존 2개 + 새로 8개
    });
  });

  describe('모드 옵션', () => {
    it('기본 모드는 readwrite로 쓰기 작업이 가능해야 함', async () => {
      const tx = db.startTransaction(['accounts']);

      tx.accounts.put({ id: 'test', name: 'Test', balance: 0 });

      await tx.commit();

      const account = await db.accounts.get('test');
      expect(account).toBeDefined();
    });

    it('write 모드에서는 읽기/쓰기 모두 가능해야 함', async () => {
      const tx = db.startTransaction(['accounts'], { mode: 'write' });

      tx.accounts.get('acc1');
      tx.accounts.put({ id: 'acc3', name: 'Account 3', balance: 300 });

      await tx.commit();

      const account = await db.accounts.get('acc3');
      expect(account).toBeDefined();
    });
  });

  describe('단일 스토어명 인자', () => {
    it('단일 스토어명으로 트랜잭션을 시작할 수 있어야 함', async () => {
      const tx = db.startTransaction('accounts');

      tx.accounts.put({ id: 'single', name: 'Single Store', balance: 999 });

      await tx.commit();

      const account = await db.accounts.get('single');
      expect(account).toBeDefined();
      expect(account?.name).toBe('Single Store');
    });
  });

  describe('raw 속성', () => {
    it('트랜잭션의 raw IDBTransaction에 접근할 수 있어야 함', async () => {
      const tx = db.startTransaction(['accounts']);

      expect(tx.raw).toBeDefined();
      expect(tx.raw).toBeInstanceOf(IDBTransaction);

      tx.accounts.put({ id: 'raw-test', name: 'Raw Test', balance: 0 });
      await tx.commit();
    });
  });
});
