/**
 * main.js — 程序入口
 * 初始化 Konva stage, 连接 UI 与 Simulation, 绑定事件
 */

import { Simulation } from './simulation.js';

// ── Konva Stage 初始化 ────────────────────────────────────

const canvasArea  = document.getElementById('canvas-area');
const stageW      = canvasArea.clientWidth;
const stageH      = canvasArea.clientHeight;

const stage = new Konva.Stage({
  container: 'konva-container',
  width:  stageW,
  height: stageH,
});

// 两层: wire 层在下, device 层在上
const wireLayer   = new Konva.Layer();
const deviceLayer = new Konva.Layer();
stage.add(wireLayer, deviceLayer);

// ── Resize handler ────────────────────────────────────────

window.addEventListener('resize', () => {
  stage.width(canvasArea.clientWidth);
  stage.height(canvasArea.clientHeight);
  stage.batchDraw();
});

// ── Simulation 初始化 ──────────────────────────────────────

const sim = new Simulation({
  layer: deviceLayer,
  onLog: appendLog,
  onStatusChange: setStatus,
  onDeviceSelected: renderPropPanel,
});

sim.setWireLayer(wireLayer);

// ── UI: Status ────────────────────────────────────────────

function setStatus(state) {
  const dot   = document.getElementById('status-dot');
  const label = document.getElementById('status-label');
  dot.className = 'status-dot';

  if (state === 'running') {
    dot.classList.add('running');
    label.textContent = '仿真运行中...';
  } else if (state === 'error') {
    dot.classList.add('error');
    label.textContent = '仿真错误';
  } else {
    label.textContent = '就绪';
  }
}

// ── UI: Log panel ─────────────────────────────────────────

function appendLog(msg, type = 'info') {
  const logEl = document.getElementById('sim-log');
  const line  = document.createElement('div');
  line.className = `log-line log-${type}`;
  const time = new Date().toLocaleTimeString('zh',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});
  line.textContent = `[${time}] ${msg}`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;

  // Limit to 200 lines
  while (logEl.children.length > 200) logEl.removeChild(logEl.firstChild);
}

// ── UI: Property panel ────────────────────────────────────

let _currentDev = null;

function renderPropPanel(dev) {
  _currentDev = dev;
  const panel = document.getElementById('prop-panel');

  if (!dev) {
    panel.innerHTML = `<div class="prop-empty"><div>🔧</div><div>选中器件查看属性</div></div>`;
    return;
  }

  panel.innerHTML = dev.renderPropPanel();

  // Bind input changes
  panel.querySelectorAll('.prop-input').forEach(input => {
    input.addEventListener('change', () => {
      const key = input.dataset.key;
      const val = parseFloat(input.value);
      if (!isNaN(val)) {
        dev.setProp(key, val);
        appendLog(`[${dev.id.slice(-4)}] ${key} = ${val}`, 'data');
      }
    });
  });

  // Delete button
  const delBtn = document.createElement('button');
  delBtn.className = 'tool-btn danger';
  delBtn.style.marginTop = '10px';
  delBtn.textContent = '✕ 删除此器件';
  delBtn.style.width = '100%';
  delBtn.onclick = () => {
    sim.removeDevice(dev.id);
    updateCanvasHint();
  };
  panel.appendChild(delBtn);
}

// ── UI: Canvas empty hint ─────────────────────────────────

function updateCanvasHint() {
  const hint = document.getElementById('canvas-empty');
  if (hint) hint.classList.toggle('hidden', sim.devices.size > 0);
}

// ── Header buttons ────────────────────────────────────────

document.getElementById('btn-run').addEventListener('click', () => {
  sim.start();
});

document.getElementById('btn-stop').addEventListener('click', () => {
  sim.stop();
});

document.getElementById('btn-reset').addEventListener('click', () => {
  if (confirm('确定重置整个电路？')) {
    sim.reset();
    renderPropPanel(null);
    updateCanvasHint();
    appendLog('电路已重置', 'warn');
  }
});

// ── Mode buttons ──────────────────────────────────────────

const modeBtns = {
  'mode-wire':   'wire',
  'mode-move':   'move',
  'mode-delete': 'delete',
};

Object.entries(modeBtns).forEach(([btnId, mode]) => {
  document.getElementById(btnId).addEventListener('click', () => {
    Object.keys(modeBtns).forEach(id => {
      document.getElementById(id).classList.remove('active');
    });
    document.getElementById(btnId).classList.add('active');
    sim.setMode(mode);
    appendLog(`切换模式: ${mode}`, 'info');
  });
});

// ── Palette — click to add ────────────────────────────────

document.querySelectorAll('.palette-item').forEach(item => {
  const typeName = item.dataset.device;
  // make HTML palette items draggable (enables dragstart)
  item.setAttribute('draggable', 'true');

  item.addEventListener('click', (e) => {
    console.log('palette click:', typeName);
    // compute canvas center in stage coordinates (respect pan/zoom)
    const rect = canvasArea.getBoundingClientRect();
    const cxScreen = rect.width/2 + (Math.random()-0.5)*100;
    const cyScreen = rect.height/2 + (Math.random()-0.5)*80;
    const cx = (cxScreen - stage.x()) / stage.scaleX();
    const cy = (cyScreen - stage.y()) / stage.scaleY();
    sim.addDevice(typeName, cx, cy);
    updateCanvasHint();
  });

  // Drag to drop — set device type on dataTransfer
  item.addEventListener('dragstart', (e) => {
    console.log('palette dragstart:', typeName);
    e.dataTransfer.setData('device', typeName);
  });
});

canvasArea.addEventListener('dragover', (e) => e.preventDefault());
canvasArea.addEventListener('drop', (e) => {
  e.preventDefault();
  const typeName = e.dataTransfer.getData('device');
  console.log('canvas drop, got device:', typeName);
  if (!typeName) return;
  const rect = canvasArea.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;
  // convert screen pixels into stage coordinates (account for pan/zoom)
  const x = (px - stage.x()) / stage.scaleX();
  const y = (py - stage.y()) / stage.scaleY();
  sim.addDevice(typeName, x, y);
  updateCanvasHint();
});

// ── Stage background click = deselect ─────────────────────

stage.on('click tap', (e) => {
  if (e.target === stage) {
    if (_currentDev) {
      _currentDev.setSelected(false);
      _currentDev = null;
      renderPropPanel(null);
    }
  }
});

// ── Keyboard shortcuts ────────────────────────────────────

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;

  switch(e.key) {
    case ' ':
      e.preventDefault();
      sim.running ? sim.stop() : sim.start();
      break;
    case 'w': case 'W':
      document.getElementById('mode-wire').click();
      break;
    case 'm': case 'M':
      document.getElementById('mode-move').click();
      break;
    case 'Delete': case 'Backspace':
      if (_currentDev) {
        sim.removeDevice(_currentDev.id);
        _currentDev = null;
        renderPropPanel(null);
        updateCanvasHint();
      }
      break;
    case 'd': case 'D':
      sim.buildDemoCircuit();
      updateCanvasHint();
      break;
  }
});

// ── Stage zoom & pan ──────────────────────────────────────

let isPanning = false;
let lastPointerPos = null;

stage.on('wheel', (e) => {
  e.evt.preventDefault();
  const scaleBy = 1.08;
  const oldScale = stage.scaleX();
  const pointer  = stage.getPointerPosition();
  const mousePointTo = {
    x: (pointer.x - stage.x()) / oldScale,
    y: (pointer.y - stage.y()) / oldScale,
  };
  const newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
  const clamped  = Math.max(0.2, Math.min(4, newScale));
  stage.scale({ x: clamped, y: clamped });
  stage.position({
    x: pointer.x - mousePointTo.x * clamped,
    y: pointer.y - mousePointTo.y * clamped,
  });
  stage.batchDraw();
});

// Middle-mouse or Alt+drag to pan
stage.on('mousedown', (e) => {
  if (e.evt.button === 1 || e.evt.altKey) {
    isPanning = true;
    lastPointerPos = stage.getPointerPosition();
    e.evt.preventDefault();
  }
});

stage.on('mousemove', () => {
  if (!isPanning) return;
  const pos  = stage.getPointerPosition();
  const dx   = pos.x - lastPointerPos.x;
  const dy   = pos.y - lastPointerPos.y;
  stage.position({ x: stage.x()+dx, y: stage.y()+dy });
  lastPointerPos = pos;
  stage.batchDraw();
});

stage.on('mouseup', () => { isPanning = false; });

// ── Init: load demo on first visit ───────────────────────

appendLog('✓ SIMLAB Circuit Lab 初始化完成', 'ok');
appendLog('提示: 按 D 键加载演示电路, Space 键运行仿真', 'info');
appendLog('提示: 滚轮缩放 · Alt+拖拽平移画布 · W 连线 · M 移动', 'info');

updateCanvasHint();
