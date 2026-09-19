import type { MoveTask, Box, BoxStatus, ScanRecord, ScanSource } from './types';
import { uid } from './utils';

const DB_NAME = 'MovingBoxTracker';
const DB_VERSION = 1;
const STORE_TASKS = 'tasks';

// 同一箱在该时间窗内重复扫码，合并成一条（连着扫好几回）
const SCAN_MERGE_WINDOW_MS = 2 * 60 * 1000;

function normalizeTask(raw: MoveTask): MoveTask {
  if (!raw.scanRecords) raw.scanRecords = [];
  return raw;
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
    req.onsuccess = () => resolve((req.result as MoveTask[]).map(normalizeTask));
    req.onerror = () => reject(req.error);
  });
}

export async function getTask(id: string): Promise<MoveTask | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TASKS, 'readonly');
    const store = tx.objectStore(STORE_TASKS);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result ? normalizeTask(req.result as MoveTask) : null);
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

// 记录一次扫码：同一箱在合并窗口内连扫，累计次数而不是新开一条
export async function recordScan(
  taskId: string,
  box: Box,
  source: ScanSource,
): Promise<{ task: MoveTask; record: ScanRecord }> {
  const task = await getTask(taskId);
  if (!task) throw new Error('Task not found');
  task.scanRecords ??= [];
  const now = Date.now();

  const lastIdx = task.scanRecords.findIndex((r) => r.boxId === box.id);
  const last = lastIdx >= 0 ? task.scanRecords[lastIdx] : null;

  if (last && now - last.lastScannedAt <= SCAN_MERGE_WINDOW_MS) {
    last.scanCount += 1;
    last.lastScannedAt = now;
    // 合并的记录留在列表顶部，保持时间倒序
    task.scanRecords.splice(lastIdx, 1);
    task.scanRecords.unshift(last);
    await saveTask(task);
    return { task, record: last };
  }

  const record: ScanRecord = {
    id: uid(),
    boxId: box.id,
    code: box.code,
    roomTo: box.roomTo,
    source,
    firstScannedAt: now,
    lastScannedAt: now,
    scanCount: 1,
    statusAtScan: box.status,
  };
  task.scanRecords.unshift(record);
  await saveTask(task);
  return { task, record };
}

// 把查箱时改的状态标记到对应扫码记录上：看得出这一改发生在扫码的时候
export async function markScanStatusChange(
  taskId: string,
  recordId: string,
  previousStatus: BoxStatus,
  nextStatus: BoxStatus,
): Promise<MoveTask> {
  const task = await getTask(taskId);
  if (!task) throw new Error('Task not found');
  const record = task.scanRecords.find((r) => r.id === recordId);
  if (!record) return task;

  if (nextStatus === record.statusAtScan) {
    // 改回调出时的状态，视为没有改动
    delete record.changedFromStatus;
    delete record.changedToStatus;
    delete record.changedAt;
  } else {
    record.changedFromStatus = previousStatus === record.statusAtScan ? record.statusAtScan : previousStatus;
    record.changedToStatus = nextStatus;
    record.changedAt = Date.now();
  }
  await saveTask(task);
  return task;
}
