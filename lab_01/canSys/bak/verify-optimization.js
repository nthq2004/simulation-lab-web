#!/usr/bin/env node

/**
 * 性能优化验证清单
 * 运行此脚本检查所有优化是否正确实施
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = __dirname;
const CHECKS = [];

function check(name, condition, message) {
    const result = condition ? '✅' : '❌';
    const status = condition ? 'PASS' : 'FAIL';
    CHECKS.push({ name, status, message });
    console.log(`${result} ${name}: ${message}`);
}

function readFile(filePath) {
    try {
        return fs.readFileSync(path.join(PROJECT_ROOT, filePath), 'utf8');
    } catch (e) {
        return '';
    }
}

function contains(filePath, text) {
    const content = readFile(filePath);
    return content.includes(text);
}

// ═══════════════════════════════════════════════════════════════════

console.log('\n🔍 性能优化验证清单\n' + '='.repeat(50) + '\n');

// 1. 帧率限制检查
console.log('📊 1. 帧率限制检查');
check(
    '帧率上限设置',
    contains('consys.js', 'deltaTime >= 16'),
    '已添加 16ms（60fps）帧率限制'
);
check(
    '帧率状态跟踪',
    contains('consys.js', '_lastFrameTime'),
    '已添加 _lastFrameTime 帧时间戳'
);

// 2. 条件重绘检查
console.log('\n📋 2. 条件重绘检查');
check(
    'Renderer 重绘优化',
    contains('lib/Renderer.js', 'sys._needsRedraw = true') && 
    !contains('lib/Renderer.js', '_renderGroup(conns, type) {\n        const sys = this.sys;\n        const nodesRef = type === \'pipe\' ? \'pipeNodes\' : \'wireNodes\';\n        sys[nodesRef].forEach(n => n.destroy());\n        sys[nodesRef] = [];\n\n        const getPosByPort = (portId) => {\n            const did = portId.split(\'_\')[0];\n            return sys.comps[did]?.getAbsPortPos(portId);\n        };\n\n        conns.forEach(conn => {\n            const p1 = getPosByPort(conn.from);\n            const p2 = getPosByPort(conn.to);\n            if (!p1 || !p2) return;\n\n            let line;\n            if (type === \'pipe\') {\n                line = this._drawPipe(conn, p1, p2, sys, nodesRef);\n            } else {\n                line = this._drawWire(conn, p1, p2, sys, nodesRef);\n            }\n            line.moveToBottom();\n        });\n        sys.lineLayer.batchDraw();'),
    '已移除 _renderGroup 中的直接 batchDraw() 调用'
);
check(
    'redrawAll 优化',
    contains('lib/Renderer.js', 'sys.requestRedraw()'),
    '已在 redrawAll 中调用 requestRedraw'
);

// 3. 动画帧率检查
console.log('\n🎬 3. 连线动画帧率检查');
check(
    '动画间隔限制',
    contains('lib/ConnectionManager.js', 'lastDrawTime') &&
    contains('lib/ConnectionManager.js', 'now - lastDrawTime >= 16'),
    '已添加 16ms 动画帧率限制'
);

// 4. 物理计算缓存检查
console.log('\n⚡ 4. 物理计算缓存检查');
check(
    '连接缓存签名',
    contains('tools/CircuitSolver.js', '_getConnectionSignature') &&
    contains('tools/CircuitSolver.js', '_lastConnectionSig'),
    '已添加连接签名缓存机制'
);
check(
    '快速路径判断',
    contains('tools/CircuitSolver.js', 'this._lastConnectionCount === connections.length'),
    '已实现连接数量快速检查'
);

// 5. 性能监测检查
console.log('\n📈 5. 性能监测工具检查');
check(
    '监测工具创建',
    fs.existsSync(path.join(PROJECT_ROOT, 'tools/PerformanceMonitor.js')),
    '✅ PerformanceMonitor.js 已创建'
);
check(
    '监测工具导入',
    contains('consys.js', "import { perfMonitor } from './tools/PerformanceMonitor.js'"),
    '已在 consys.js 中导入 perfMonitor'
);
check(
    '渲染监测集成',
    contains('consys.js', "perfMonitor.recordMetric('renderLoop'") &&
    contains('consys.js', "perfMonitor.recordMetric('batchDraw'"),
    '已集成渲染性能监测'
);
check(
    '物理监测集成',
    contains('consys.js', "perfMonitor.recordMetric('physicUpdate'") &&
    contains('consys.js', "perfMonitor.recordMetric('circuitSolve'"),
    '已集成物理计算性能监测'
);

// 6. 文档检查
console.log('\n📚 6. 文档检查');
check(
    '完整优化文档',
    fs.existsSync(path.join(PROJECT_ROOT, 'PERFORMANCE_OPTIMIZATION.md')),
    'PERFORMANCE_OPTIMIZATION.md 已创建'
);
check(
    '快速参考指南',
    fs.existsSync(path.join(PROJECT_ROOT, 'QUICK_FIX_GUIDE.md')),
    'QUICK_FIX_GUIDE.md 已创建'
);

// ═══════════════════════════════════════════════════════════════════

console.log('\n' + '='.repeat(50));
console.log('\n📊 验证统计：\n');

const passed = CHECKS.filter(c => c.status === 'PASS').length;
const failed = CHECKS.filter(c => c.status === 'FAIL').length;
const total = CHECKS.length;

console.log(`✅ 通过: ${passed}/${total}`);
console.log(`❌ 失败: ${failed}/${total}`);
console.log(`📈 通过率: ${((passed / total) * 100).toFixed(1)}%\n`);

if (failed === 0) {
    console.log('🎉 所有检查通过！性能优化已完整实施。\n');
    console.log('📖 后续步骤：');
    console.log('  1. 启动项目 (npm run dev)');
    console.log('  2. 打开浏览器 DevTools (F12)');
    console.log('  3. Performance 标签录制运行情况');
    console.log('  4. 对比优化前后的帧率和耗时');
    console.log('  5. 在控制台运行: perfMonitor.enable() 进行详细监测\n');
} else {
    console.log('⚠️  有 ' + failed + ' 个检查失败，请检查实施情况。\n');
}

// ═══════════════════════════════════════════════════════════════════

// 性能预期
console.log('📊 性能改进预期：\n');
console.log('┌─────────────────────────────────────────┐');
console.log('│ 指标           │ 优化前  │ 优化后 │ 改进 │');
console.log('├─────────────────────────────────────────┤');
console.log('│ RAF 耗时       │ 163ms  │ <20ms │ 88% ↓│');
console.log('│ 帧率           │ 不稳定 │ 60fps │ 稳定 │');
console.log('│ CPU 占用       │ 80%+   │ 20-30%│ 显著↓│');
console.log('│ 内存抖动       │ 频繁   │ 平稳  │ 改善 │');
console.log('└─────────────────────────────────────────┘\n');

process.exit(failed > 0 ? 1 : 0);
