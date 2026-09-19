export type BoxStatus = 'packed' | 'loaded' | 'arrived' | 'unpacked' | 'damaged' | 'missing';

export type ScanSource = 'camera' | 'manual';

export type ScanRecord = {
  id: string;
  boxId: string;
  code: string; // 箱号快照
  roomTo: string; // 目标房间快照
  source: ScanSource; // 第一次扫的方式
  firstScannedAt: number; // 第一次扫码时间
  lastScannedAt: number; // 最后一次扫码时间（合并连扫用）
  scanCount: number; // 合并的扫码次数
  statusAtScan: BoxStatus; // 第一次扫码时箱子的状态
  // 查箱时顺手改了状态时记录（看得出改动发生在扫码时）
  changedFromStatus?: BoxStatus;
  changedToStatus?: BoxStatus;
  changedAt?: number;
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
