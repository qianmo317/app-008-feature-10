export type BoxStatus = 'packed' | 'loaded' | 'arrived' | 'unpacked' | 'damaged' | 'missing';

export type ScanSource = 'camera' | 'manual';

export type ScanStatusChange = {
  from: BoxStatus; // 改动前状态（扫码当时的状态）
  to: BoxStatus; // 改成的状态
  changedAt: number;
};

export type ScanRecord = {
  id: string;
  taskId: string;
  boxCode: string;
  scannedAt: number; // 第一次扫到的时间（这一条的时间锚点）
  lastScannedAt: number; // 最近一次扫到的时间
  scanCount: number; // 短时间内连扫合并后的次数
  statusAtScan: BoxStatus; // 第一次扫到时箱子的状态
  source: ScanSource;
  statusChange?: ScanStatusChange; // 扫码期间改的状态，能看出这次改动来自扫码
};

export type Box = {
  id: string;
  code: string; // e.g. A-014
  roomFrom: string;
  roomTo: string;
  tags: string[];
  fragile: boolean;
  liquid: boolean;
  photo?: string; // compressed dataURL
  weightKg?: number;
  status: BoxStatus;
  note?: string;
  createdAt: number;
  updatedAt: number;
};

export type MoveTask = {
  id: string;
  title: string;
  from: string;
  to: string;
  date: string;
  rooms: string[];
  boxes: Box[];
  scanRecords: ScanRecord[];
  createdAt: number;
};
