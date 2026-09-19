<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { getTask, updateBox, recordScan, markScanStatusChange } from '../db';
import { parseQRContent, vibrateShort, playBeep, statusColor, statusLabel, formatDateTime } from '../utils';
import type { MoveTask, Box, BoxStatus, ScanSource } from '../types';

const route = useRoute();
const router = useRouter();
const task = ref<MoveTask | null>(null);
const foundBox = ref<Box | null>(null);
const activeRecordId = ref<string | null>(null);
const manualCode = ref('');
const errorMsg = ref('');

let stream: MediaStream | null = null;
const videoRef = ref<HTMLVideoElement | null>(null);
const scanning = ref(false);

const history = computed(() => task.value?.scanRecords ?? []);
const activeRecord = computed(() => task.value?.scanRecords.find((r) => r.id === activeRecordId.value) ?? null);

async function load() {
  task.value = await getTask(route.params.id as string);
}

const hasBarcodeDetector = 'BarcodeDetector' in window;

async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    if (videoRef.value) {
      videoRef.value.srcObject = stream;
      await videoRef.value.play();
      scanning.value = true;
      if (hasBarcodeDetector) {
        scanLoop();
      } else {
        errorMsg.value = '当前浏览器不支持扫码，请使用手动输入';
      }
    }
  } catch (e) {
    errorMsg.value = '无法启动摄像头，请使用手动输入';
  }
}

async function scanLoop() {
  if (!scanning.value || !videoRef.value) return;
  const video = videoRef.value;
  if (video.readyState === video.HAVE_ENOUGH_DATA) {
    try {
      const detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
      const barcodes = await detector.detect(video);
      if (barcodes.length > 0) {
        const ok = await openScannedBox(barcodes[0].rawValue, 'camera');
        if (ok) return;
      }
    } catch {
      // ignore
    }
  }
  requestAnimationFrame(scanLoop);
}

function stopCamera() {
  scanning.value = false;
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
}

// 解析二维码内容并校验，通过后落记录并展示，返回是否成功
async function openScannedBox(text: string, source: ScanSource): Promise<boolean> {
  const parsed = parseQRContent(text);
  if (!parsed.taskId || !parsed.code) {
    errorMsg.value = '无效二维码';
    return false;
  }
  if (task.value && parsed.taskId !== task.value.id) {
    errorMsg.value = '该箱子不属于当前任务';
    return false;
  }
  const b = task.value?.boxes.find((x) => x.code === parsed.code);
  if (!b) {
    errorMsg.value = '未找到箱子';
    return false;
  }
  return showBox(b, source);
}

// 扫到/查到箱子后留一条记录
async function showBox(b: Box, source: ScanSource): Promise<boolean> {
  if (!task.value) return false;
  try {
    const { task: fresh, record } = await recordScan(task.value.id, b, source);
    task.value = fresh;
    foundBox.value = fresh.boxes.find((x) => x.id === b.id) ?? b;
    activeRecordId.value = record.id;
    vibrateShort();
    playBeep();
    errorMsg.value = '';
    stopCamera();
    return true;
  } catch {
    errorMsg.value = '扫码记录保存失败，请重试';
    return false;
  }
}

async function searchManual() {
  if (!task.value || !manualCode.value) return;
  const code = manualCode.value.trim();
  const b = task.value.boxes.find((x) => x.code.toLowerCase() === code.toLowerCase());
  if (b) {
    const ok = await showBox(b, 'manual');
    if (ok) manualCode.value = '';
  } else {
    errorMsg.value = '未找到箱子';
  }
}

async function setStatus(status: BoxStatus) {
  if (!foundBox.value || !task.value || !activeRecordId.value) return;
  const previous = foundBox.value.status;
  if (previous === status) return;
  foundBox.value.status = status;
  foundBox.value.updatedAt = Date.now();
  await updateBox(task.value.id, foundBox.value);
  // 标出这一改状态发生在扫码查箱时
  task.value = await markScanStatusChange(task.value.id, activeRecordId.value, previous, status);
  foundBox.value = task.value.boxes.find((x) => x.id === foundBox.value!.id) ?? foundBox.value;
}

function reset() {
  foundBox.value = null;
  activeRecordId.value = null;
  errorMsg.value = '';
  startCamera();
}

onMounted(() => {
  load().then(startCamera);
});

onUnmounted(stopCamera);
</script>

<template>
  <div v-if="task">
    <div class="header">
      <router-link :to="`/task/${task.id}`" class="back">←</router-link>
      <h1>扫码查箱</h1>
    </div>
    <div class="page">
      <div v-if="!foundBox">
        <video ref="videoRef" autoplay playsinline muted></video>
        <div style="margin-top:10px;">
          <input v-model="manualCode" class="input" placeholder="或手动输入箱号" @keyup.enter="searchManual" />
          <button class="btn btn-block" style="margin-top:8px;" @click="searchManual">查询</button>
        </div>
        <div v-if="errorMsg" style="color:var(--danger);margin-top:8px;font-size:14px;">{{ errorMsg }}</div>
      </div>

      <div v-else>
        <div class="card" style="text-align:center;">
          <div style="font-size:36px;font-weight:800;">{{ foundBox.code }}</div>
          <div style="font-size:16px;color:var(--text-secondary);margin-top:4px;">{{ foundBox.roomTo }}</div>
          <div style="margin-top:10px;">
            <span class="status-dot" :style="{background: statusColor(foundBox.status)}"></span>
            <span style="margin-left:6px;">{{ statusLabel(foundBox.status) }}</span>
          </div>
          <div v-if="activeRecord && activeRecord.scanCount > 1" style="margin-top:8px;font-size:13px;color:var(--text-secondary);">
            近 2 分钟内已连扫 {{ activeRecord.scanCount }} 次（合并为一条记录）
          </div>
        </div>
        <div class="card">
          <div style="font-weight:700;margin-bottom:8px;">快速改状态</div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;">
            <button class="tag" :class="{active: foundBox.status === 'packed'}" @click="setStatus('packed')">待打包</button>
            <button class="tag" :class="{active: foundBox.status === 'loaded'}" @click="setStatus('loaded')">已装车</button>
            <button class="tag" :class="{active: foundBox.status === 'arrived'}" @click="setStatus('arrived')">已到达</button>
            <button class="tag" :class="{active: foundBox.status === 'unpacked'}" @click="setStatus('unpacked')">已拆箱</button>
            <button class="tag" :class="{active: foundBox.status === 'damaged'}" @click="setStatus('damaged')">破损</button>
            <button class="tag" :class="{active: foundBox.status === 'missing'}" @click="setStatus('missing')">缺失</button>
          </div>
        </div>
        <div class="toolbar">
          <button class="btn" @click="router.push(`/task/${task.id}/box/${foundBox.code}`)">查看详情</button>
          <button class="btn btn-secondary" @click="reset">继续扫码</button>
        </div>
      </div>

      <div class="card">
        <div style="display:flex;align-items:baseline;margin-bottom:10px;">
          <span style="font-weight:700;">扫码记录</span>
          <span v-if="history.length" style="margin-left:auto;font-size:12px;color:var(--text-secondary);">共 {{ history.length }} 条 · 2 分钟内连扫自动合并</span>
        </div>
        <div v-if="history.length === 0" class="empty" style="padding:20px 0;">还没有扫码记录</div>
        <div
          v-for="r in history"
          :key="r.id"
          class="scan-row"
          :class="{ active: r.id === activeRecordId }"
          @click="router.push(`/task/${task.id}/box/${r.code}`)"
        >
          <span class="status-dot" :style="{ background: statusColor(r.statusAtScan) }"></span>
          <div class="scan-main">
            <div class="scan-line1">
              <strong>{{ r.code }}</strong>
              <span class="scan-room">{{ r.roomTo }}</span>
              <span v-if="r.source === 'manual'" class="scan-badge">手输</span>
              <span class="scan-time">{{ formatDateTime(r.firstScannedAt) }}</span>
            </div>
            <div class="scan-line2">
              扫到时为「{{ statusLabel(r.statusAtScan) }}」
              <template v-if="r.changedToStatus">
                · <span class="scan-changed">扫码时改状态 {{ statusLabel(r.changedFromStatus ?? r.statusAtScan) }} → {{ statusLabel(r.changedToStatus) }}</span>
              </template>
            </div>
            <div v-if="r.scanCount > 1" class="scan-line3">
              2 分钟内连扫 {{ r.scanCount }} 次，末次 {{ formatDateTime(r.lastScannedAt) }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.scan-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 8px;
  border-top: 1px solid var(--border);
  cursor: pointer;
}
.scan-row:first-of-type {
  border-top: none;
}
.scan-row.active {
  background: rgba(245, 158, 11, 0.12);
  border-radius: 8px;
}
.scan-main {
  flex: 1;
  min-width: 0;
}
.scan-line1 {
  display: flex;
  align-items: center;
  gap: 8px;
}
.scan-room {
  font-size: 13px;
  color: var(--text-secondary);
}
.scan-time {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.scan-badge {
  font-size: 11px;
  color: var(--text-secondary);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0 4px;
}
.scan-line2 {
  margin-top: 3px;
  font-size: 13px;
  color: var(--text-secondary);
}
.scan-changed {
  color: var(--primary-dark);
  font-weight: 600;
}
.scan-line3 {
  margin-top: 2px;
  font-size: 12px;
  color: var(--text-secondary);
}
</style>
