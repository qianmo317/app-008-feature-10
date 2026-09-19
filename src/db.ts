import type { MoveTask, Box, ScanRecord, ScanSource, BoxStatus } from './types';
import { uid } from './utils';

const DB_NAME = 'MovingBoxTracker';
const DB_VERSION = 1;
const STORE_TASKS = 'tasks';

// 同一箱在该时间窗内被重复扫到，合并进同一条扫码记录
export const SCAN_MERGE_WINDOW_MS = 2 * 60 * 1000;

function normalize(task: MoveTask): MoveTask {
  if (!Array.isArray(task.scanRecords)) task.scanRecords = [];
  return task;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_TASKS)) {
        db.createObjectStore(STORE_TASKS, { keyPath: 'id' });
      }
    };
  });
}

export async function getAllTasks(): Promise<MoveTask[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TASKS, 'readonly');
    const store = tx.objectStore(STORE_TASKS);
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result as MoveTask[]).map(normalize));
    req.onerror = () => reject(req.error);
  });
}

export async function getTask(id: string): Promise<MoveTask | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TASKS, 'readonly');
    const store = tx.objectStore(STORE_TASKS);
    const req = store.get(id);
    req.onsuccess = () => {
      const t = req.result as MoveTask | undefined;
      resolve(t ? normalize(t) : null);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function saveTask(task: MoveTask): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TASKS, 'readwrite');
    const store = tx.objectStore(STORE_TASKS);
    const req = store.put(task);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function deleteTask(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TASKS, 'readwrite');
    const store = tx.objectStore(STORE_TASKS);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function addBox(taskId: string, box: Box): Promise<void> {
  const task = await getTask(taskId);
  if (!task) throw new Error('Task not found');
  task.boxes.push(box);
  await saveTask(task);
}

export async function updateBox(taskId: string, box: Box): Promise<void> {
  const task = await getTask(taskId);
  if (!task) throw new Error('Task not found');
  const idx = task.boxes.findIndex((b) => b.id === box.id);
  if (idx === -1) throw new Error('Box not found');
  task.boxes[idx] = box;
  await saveTask(task);
}

export async function deleteBox(taskId: string, boxId: string): Promise<void> {
  const task = await getTask(taskId);
  if (!task) throw new Error('Task not found');
  task.boxes = task.boxes.filter((b) => b.id !== boxId);
  await saveTask(task);
}

/**
 * 记下一次扫码。同一箱在 SCAN_MERGE_WINDOW_MS 内被连扫多次时，
 * 合并进最近的同一条记录，只累加次数。
 * 返回扫码记录及本次是否被合并。
 */
export async function recordScan(
  taskId: string,
  boxCode: string,
  status: BoxStatus,
  source: ScanSource,
  now = Date.now(),
): Promise<{ record: ScanRecord; merged: boolean }> {
  const task = await getTask(taskId);
  if (!task) throw new Error('Task not found');
  const last = task.scanRecords[task.scanRecords.length - 1];
  if (last && last.boxCode === boxCode && now - last.lastScannedAt <= SCAN_MERGE_WINDOW_MS) {
    last.lastScannedAt = now;
    last.scanCount += 1;
    await saveTask(task);
    return { record: last, merged: true };
  }
  const record: ScanRecord = {
    id: uid(),
    taskId,
    boxCode,
    scannedAt: now,
    lastScannedAt: now,
    scanCount: 1,
    statusAtScan: status,
    source,
  };
  task.scanRecords.push(record);
  await saveTask(task);
  return { record, merged: false };
}

/**
 * 标记某条扫码记录期间发生的状态改动。from 固定为扫码当时的状态，
 * to 不断更新为最后改成的状态；在别处（非扫码）改状态不会打到这里。
 */
export async function markScanStatusChange(
  taskId: string,
  scanRecordId: string,
  to: BoxStatus,
  now = Date.now(),
): Promise<void> {
  const task = await getTask(taskId);
  if (!task) throw new Error('Task not found');
  const rec = task.scanRecords.find((r) => r.id === scanRecordId);
  if (!rec) return;
  if (rec.statusChange) {
    rec.statusChange.to = to;
    rec.statusChange.changedAt = now;
  } else {
    rec.statusChange = { from: rec.statusAtScan, to, changedAt: now };
  }
  await saveTask(task);
}
