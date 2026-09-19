<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { getTask, updateBox, recordScan, markScanStatusChange } from '../db';
import { parseQRContent, vibrateShort, playBeep, statusColor, statusLabel, formatTime, formatDayLabel } from '../utils';
import type { MoveTask, Box, ScanRecord } from '../types';

const route = useRoute();
const router = useRouter();
const task = ref<MoveTask | null>(null);
const foundBox = ref<Box | null>(null);
const foundRecordId = ref<string | null>(null);
const manualCode = ref('');
const errorMsg = ref('');
const toastMsg = ref('');

let toastTimer: ReturnType<typeof setTimeout> | null = null;
function showToast(msg: string) {
  toastMsg.value = msg;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastMsg.value = ''), 2500);
}

let stream: MediaStream | null = null;
const videoRef = ref<HTMLVideoElement | null>(null);
const historyRef = ref<HTMLDivElement | null>(null);
const scanning = ref(false);
let lastInvalidHintAt = 0;

// 扫码记录按时间正序，最新的在最下面；同一天合并显示一个分组标题
const historyGroups = computed(() => {
  if (!task.value) return [] as { label: string; records: ScanRecord[] }[];
  const groups: { label: string; records: ScanRecord[] }[] = [];
  for (const rec of task.value.scanRecords) {
    const label = formatDayLabel(rec.scannedAt);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.records.push(rec);
    else groups.push({ label, records: [rec] });
  }
  return groups;
});

async function load() {
  task.value = await getTask(route.params.id as string);
  await nextTick();
  scrollHistoryToBottom();
}

function scrollHistoryToBottom() {
  const el = historyRef.value;
  if (el) el.scrollTop = el.scrollHeight;
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
        // 扫到有效箱子才停；无效码/别的任务的箱子只提示，继续扫
        const ok = handleScan(barcodes[0].rawValue);
        if (ok) return;
      }
    } catch {
      // ignore
    }
  }
  requestAnimationFrame(scanLoop);
}

function handleScan(text: string, source: 'camera' | 'manual' = 'camera'): boolean {
  const parsed = parseQRContent(text);
  if (!parsed.taskId || !parsed.code) {
    hintInvalid('无效二维码');
    return false;
  }
  if (task.value && parsed.taskId !== task.value.id) {
    hintInvalid('该箱子不属于当前任务');
    return false;
  }
  const b = task.value?.boxes.find((x) => x.code === parsed.code);
  if (!b) {
    hintInvalid('未找到箱子');
    return false;
  }
  void commitScan(b, source);
  return true;
}

function hintInvalid(msg: string) {
  // 摄像头对着无效码会连续报错，限一下频
  const now = Date.now();
  if (now - lastInvalidHintAt > 1500) {
    errorMsg.value = msg;
    lastInvalidHintAt = now;
  }
}

async function commitScan(b: Box, source: 'camera' | 'manual') {
  if (!task.value) return;
  const { record, merged } = await recordScan(task.value.id, b.code, b.status, source);
  task.value = await getTask(task.value!.id);
  foundBox.value = b;
  foundRecordId.value = record.id;
  vibrateShort();
  playBeep();
  errorMsg.value = '';
  if (merged) {
    showToast(`同一箱连扫，已合并为一条，共记录 ${record.scanCount} 次`);
  }
  scanning.value = false;
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  await nextTick();
  scrollHistoryToBottom();
}

function searchManual() {
  if (!task.value || !manualCode.value) return;
  const code = manualCode.value.trim();
  const b = task.value.boxes.find((x) => x.code.toLowerCase() === code.toLowerCase());
  if (b) {
    void commitScan(b, 'manual');
  } else {
    errorMsg.value = '未找到箱子';
  }
}

async function setStatus(status: Box['status']) {
  if (!foundBox.value || !task.value || !foundRecordId.value) return;
  if (foundBox.value.status === status) return;
  foundBox.value.status = status;
  foundBox.value.updatedAt = Date.now();
  await updateBox(task.value.id, foundBox.value);
  // 这次改动标记在扫码记录上，看得出是扫码时改的状态
  await markScanStatusChange(task.value.id, foundRecordId.value, status);
  task.value = await getTask(task.value.id);
  const fresh = task.value?.boxes.find((x) => x.id === foundBox.value!.id);
  if (fresh) foundBox.value = fresh;
  await nextTick();
  scrollHistoryToBottom();
}

async function reset() {
  foundBox.value = null;
  foundRecordId.value = null;
  manualCode.value = '';
  errorMsg.value = '';
  await load();
  startCamera();
}

onMounted(() => {
  load().then(startCamera);
});

onUnmounted(() => {
  scanning.value = false;
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
});
</script>

<template>
  <div v-if="task">
    <div class="header">
      <router-link :to="`/task/${task.id}`" class="back">←</router-link>
      <h1>扫码查箱</h1>
    </div>
    <div class="page">
      <!-- 扫到箱子后的详情/改态面板 -->
      <div v-if="foundBox">
        <div class="card" style="text-align:center;">
          <div style="font-size:36px;font-weight:800;">{{ foundBox.code }}</div>
          <div style="font-size:16px;color:var(--text-secondary);margin-top:4px;">{{ foundBox.roomTo }}</div>
          <div style="margin-top:10px;">
            <span class="status-dot" :style="{background: statusColor(foundBox.status)}"></span>
            <span style="margin-left:6px;">{{ statusLabel(foundBox.status) }}</span>
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
          <div style="font-size:12px;color:var(--text-secondary);margin-top:8px;">
            在这里改状态，会记到本次扫码记录上
          </div>
        </div>
        <div class="toolbar">
          <button class="btn" @click="router.push(`/task/${task.id}/box/${foundBox.code}`)">查看详情</button>
          <button class="btn btn-secondary" @click="reset">继续扫码</button>
        </div>
      </div>

      <!-- 扫码区 -->
      <div v-else>
        <video ref="videoRef" autoplay playsinline muted></video>
        <div style="margin-top:10px;">
          <input v-model="manualCode" class="input" placeholder="或手动输入箱号" @keyup.enter="searchManual" />
          <button class="btn btn-block" style="margin-top:8px;" @click="searchManual">查询</button>
        </div>
        <div v-if="errorMsg" style="color:var(--danger);margin-top:8px;font-size:14px;">{{ errorMsg }}</div>
      </div>

      <!-- 扫码记录：按时间排列，往下是最新，可往上翻 -->
      <div class="card" style="margin-top:14px;padding:12px 14px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <div style="font-weight:700;">扫码记录</div>
          <div style="font-size:12px;color:var(--text-secondary);">共 {{ task.scanRecords.length }} 条</div>
        </div>
        <div v-if="task.scanRecords.length === 0" class="empty" style="padding:20px 0;">
          还没有扫码记录
        </div>
        <div ref="historyRef" v-else class="history-list">
          <template v-for="g in historyGroups" :key="g.label">
            <div class="history-day">{{ g.label }}</div>
            <div
              v-for="rec in g.records"
              :key="rec.id"
              class="history-item"
              :class="{active: rec.id === foundRecordId}"
              @click="router.push(`/task/${task.id}/box/${rec.boxCode}`)"
            >
              <div style="display:flex;align-items:center;gap:8px;">
                <span class="status-dot" :style="{background: statusColor(rec.statusAtScan)}"></span>
                <span style="font-weight:700;font-size:15px;">{{ rec.boxCode }}</span>
                <span v-if="rec.scanCount > 1" class="count-badge">连扫 ×{{ rec.scanCount }}</span>
                <span v-if="rec.source === 'manual'" class="src-badge">手输</span>
              </div>
              <div style="font-size:12px;color:var(--text-secondary);margin-top:3px;">
                <span>{{ formatTime(rec.scannedAt) }}</span>
                <template v-if="rec.scanCount > 1">
                  <span> 至 {{ formatTime(rec.lastScannedAt) }}</span>
                </template>
                <span style="margin-left:6px;">扫码时：{{ statusLabel(rec.statusAtScan) }}</span>
              </div>
              <div v-if="rec.statusChange" class="change-line">
                扫码时改状态：{{ statusLabel(rec.statusChange.from) }}
                <span style="margin:0 4px;">→</span>
                <span :style="{color: statusColor(rec.statusChange.to), fontWeight: 700}">
                  {{ statusLabel(rec.statusChange.to) }}
                </span>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>

    <div v-if="toastMsg" class="toast">{{ toastMsg }}</div>
  </div>
</template>

<style scoped>
.history-list {
  max-height: 46vh;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
.history-day {
  position: sticky;
  top: 0;
  background: var(--surface);
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 700;
  padding: 6px 0;
  z-index: 1;
}
.history-item {
  padding: 10px 8px;
  border-top: 1px solid var(--border);
  cursor: pointer;
  border-radius: 8px;
}
.history-item.active {
  background: rgba(245, 158, 11, 0.12);
}
.count-badge {
  font-size: 11px;
  font-weight: 700;
  color: var(--primary-dark);
  background: rgba(245, 158, 11, 0.18);
  border-radius: 999px;
  padding: 1px 8px;
}
.src-badge {
  font-size: 11px;
  color: var(--text-secondary);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0 7px;
}
.change-line {
  margin-top:5px;
  font-size: 12px;
  color: var(--primary-dark);
  background: rgba(245, 158, 11, 0.12);
  border-radius: 6px;
  padding: 3px 8px;
}
.toast {
  position: fixed;
  left: 50%;
  bottom: 32px;
  transform: translateX(-50%);
  background: rgba(31, 41, 55, 0.92);
  color: #fff;
  font-size: 13px;
  padding: 10px 16px;
  border-radius: 999px;
  z-index: 50;
  max-width: 86vw;
  text-align: center;
}
</style>
