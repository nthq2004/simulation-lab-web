/**
 * IASServer.js — IAS 机舱监测与报警监控主机
 * 船舶机舱监测报警系统 · Modbus 通信架构
 *
 * 功能：
 *   1. TCP Server 响应 PLC 的请求
 *   2. 定时轮询 PLC 获取从站数据
 *   3. 报警管理（高/低限检查、确认）
 *   4. 大尺寸机舱监测屏图形界面
 *   5. 页面切换（概览、温度、压力、电气、报警）
 */

import { BaseComponent } from '../components/BaseComponent.js';
import { ModbusTCPServer } from './ModbusTCP.js';
import { applyIASServerMixin } from './dpu/IASServer.mixin.js';

class IASServer extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width = config.width || 800;
        this.height = config.height || 500;
        this.type = 'ias_server';
        this.special = 'modbus';
        this.cache = 'fixed';

        // 网络状态
        this.plcConnected = false;
        this._plcHandler = null;

        // ── 创建 TCP 服务端 ──
        this.tcpServer = new ModbusTCPServer({ responseDelay: 30 });

        // 设置请求处理器（PLC 的 TCP 请求 → 由 PLC mixin 处理）
        this.tcpServer.setHandler((unitId, fnCode, data) => {
            if (this._plcHandler) {
                return this._plcHandler(unitId, fnCode, data);
            }
            return null;
        });

        // ── 初始化 IAS 监控状态（mixin）──
        this._initIAS();

        // ── 绘制图形界面 ──
        this._drawVisuals();
        this._drawPageContent('overview');
    }

    /**
     * 关联 PLC（由 createModbusSystem 调用）
     */
    setPLCHandler(handlerFn) {
        this._plcHandler = handlerFn;
    }

    // ══════════════════════════════════════════
    //  图形绘制
    // ══════════════════════════════════════════

    _drawVisuals() {
        // 大屏幕外壳
        this.group.add(new Konva.Rect({
            x: 0, y: 0, width: this.width, height: this.height,
            fill: '#1a1a2e', stroke: '#16213e', strokeWidth: 3, cornerRadius: 8,
        }));

        // 顶部标题栏
        this.group.add(new Konva.Rect({
            x: 0, y: 0, width: this.width, height: 40,
            fill: '#0f3460', cornerRadius: [8, 8, 0, 0],
        }));

        this.titleText = new Konva.Text({
            x: 15, y: 8, text: 'IAS 机舱监测与报警系统', fontSize: 18,
            fill: '#e94560', fontStyle: 'bold',
        });
        this.group.add(this.titleText);

        // 页面导航按钮指示
        this.navText = new Konva.Text({
            x: this.width - 200, y: 10, text: '概览 | 温度 | 压力 | 电气 | 报警',
            fontSize: 11, fill: '#a0a0b0',
        });
        this.group.add(this.navText);

        // 状态栏
        this.group.add(new Konva.Rect({
            x: 0, y: this.height - 25, width: this.width, height: 25,
            fill: '#16213e', cornerRadius: [0, 0, 8, 8],
        }));

        this.plcStatusText = new Konva.Text({
            x: 15, y: this.height - 20, text: 'PLC: 离线', fontSize: 11,
            fill: '#ff4757',
        });
        this.group.add(this.plcStatusText);

        this.alarmCountText = new Konva.Text({
            x: this.width - 200, y: this.height - 20,
            text: '报警: 0', fontSize: 11, fill: '#a0a0b0',
        });
        this.group.add(this.alarmCountText);

        this.timeText = new Konva.Text({
            x: this.width - 100, y: this.height - 20,
            text: '', fontSize: 11, fill: '#a0a0b0',
        });
        this.group.add(this.timeText);

        // 页面内容区背景
        this.pageBg = new Konva.Rect({
            x: 10, y: 45, width: this.width - 20, height: this.height - 80,
            fill: '#16213e', cornerRadius: 4,
        });
        this.group.add(this.pageBg);

        // 页面内容容器
        this.pageContent = new Konva.Group({ x: 20, y: 55 });
        this.group.add(this.pageContent);

        // 双击切换页面
        this.group.on('dblclick', (e) => {
            e.cancelBubble = true;
            const pages = this.pages;
            const idx = pages.indexOf(this.currentPage);
            this.switchPage(pages[(idx + 1) % pages.length]);
            this._drawPageContent(this.currentPage);
            this._refreshCache();
        });
    }

    _drawPageContent(page) {
        this.pageContent.destroyChildren();

        const pageTitle = new Konva.Text({
            x: 5, y: 0, text: `— ${this._getPageTitle(page)} —`,
            fontSize: 14, fill: '#e94560', fontStyle: 'bold',
        });
        this.pageContent.add(pageTitle);

        const data = this.getPageData(page);

        if (page === 'alarm') {
            this._drawAlarmTable(data);
        } else if (page === 'overview') {
            this._drawOverviewTable(data);
        } else {
            this._drawDetailTable(data);
        }

        this._refreshCache();
    }

    _drawOverviewTable(rows) {
        // 表头
        const headers = ['从站', '设备名称', '测量值', '通信状态'];
        headers.forEach((h, i) => {
            this.pageContent.add(new Konva.Text({
                x: 20 + i * 150, y: 25, text: h, fontSize: 11,
                fill: '#74b9ff', fontStyle: 'bold',
            }));
        });

        // 分隔线
        this.pageContent.add(new Konva.Line({
            points: [20, 42, 620, 42], stroke: '#636e72', strokeWidth: 1,
        }));

        // 数据行
        rows.forEach((row, idx) => {
            const y = 48 + idx * 28;
            const color = row.online ? '#dfe6e9' : '#ff4757';
            this.pageContent.add(new Konva.Text({ x: 20, y, text: `${row.slaveId}`, fontSize: 11, fill: color }));
            this.pageContent.add(new Konva.Text({ x: 170, y, text: row.name, fontSize: 11, fill: color }));
            this.pageContent.add(new Konva.Text({ x: 320, y, text: row.temp, fontSize: 11, fill: '#00ff00' }));
            this.pageContent.add(new Konva.Text({ x: 470, y, text: row.status, fontSize: 11, fill: row.online ? '#00b894' : '#ff4757' }));
        });
    }

    _drawDetailTable(items) {
        items.forEach((item, idx) => {
            const y = 30 + idx * 25;
            this.pageContent.add(new Konva.Text({ x: 20, y, text: item.label, fontSize: 11, fill: '#b2bec3' }));
            this.pageContent.add(new Konva.Text({ x: 200, y, text: item.value, fontSize: 12, fill: '#00ff00', fontStyle: 'bold' }));
        });
    }

    _drawAlarmTable(alarms) {
        if (alarms.length === 0) {
            this.pageContent.add(new Konva.Text({
                x: 20, y: 35, text: '无活跃报警', fontSize: 14,
                fill: '#00b894',
            }));
            return;
        }

        const headers = ['设备', '描述', '数值', '类型', '时间', '状态'];
        headers.forEach((h, i) => {
            this.pageContent.add(new Konva.Text({
                x: 5 + i * 100, y: 25, text: h, fontSize: 10,
                fill: '#ff4757', fontStyle: 'bold',
            }));
        });

        alarms.slice(0, 8).forEach((alarm, idx) => {
            const y = 42 + idx * 22;
            const color = alarm.acknowledged ? '#dfe6e9' : '#ff4757';
            this.pageContent.add(new Konva.Text({ x: 5, y, text: alarm.name, fontSize: 10, fill: color }));
            this.pageContent.add(new Konva.Text({ x: 105, y, text: alarm.description, fontSize: 10, fill: color }));
            this.pageContent.add(new Konva.Text({ x: 205, y, text: alarm.value, fontSize: 10, fill: '#00ff00' }));
            this.pageContent.add(new Konva.Text({ x: 305, y, text: alarm.type, fontSize: 10, fill: '#fdcb6e' }));
            this.pageContent.add(new Konva.Text({ x: 405, y, text: alarm.timestamp, fontSize: 10, fill: color }));
            const statusText = alarm.acknowledged ? '已确认' : '未确认';
            this.pageContent.add(new Konva.Text({ x: 505, y, text: statusText, fontSize: 10, fill: alarm.acknowledged ? '#00b894' : '#ff4757' }));
        });
    }

    _getPageTitle(page) {
        const titles = {
            overview: '系统概览',
            temperature: '温度监测',
            pressure: '压力监测',
            electrical: '电气参数',
            alarm: '报警列表',
        };
        return titles[page] || page;
    }

    // ══════════════════════════════════════════
    //  主循环（由 createModbusSystem 调度）
    // ══════════════════════════════════════════

    /**
     * 轮询 PLC 获取最新数据
     */
    pollPLC() {
        // 由外部通过 PLC 的 handleTCPRequest 直接填充
        // 此方法更新界面显示
        const now = Date.now();
        this.timeText.text(new Date(now).toLocaleTimeString());

        const alarmCount = this.getActiveAlarmCount();
        this.alarmCountText.text(`报警: ${alarmCount}`);

        // 检查是否有任何设备在线
        let hasOnline = false;
        for (const dev of Object.values(this.deviceData)) {
            if (dev.online) { hasOnline = true; break; }
        }

        this.plcConnected = hasOnline;
        this.plcStatusText.text(`PLC: ${hasOnline ? '在线' : '离线'}`);
        this.plcStatusText.fill(hasOnline ? '#00b894' : '#ff4757');

        // 重绘当前页面
        this._drawPageContent(this.currentPage);
    }
}

applyIASServerMixin(IASServer.prototype);
export { IASServer };
