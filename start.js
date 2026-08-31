/**
 * pnpm start — 新工程一键初始化并启动
 *
 * 流程：
 *   1. 读取当前目录名，自动写入 package.json 的 name 字段
 *   2. 切换到 网站 根目录执行 pnpm install（注册 workspace）
 *   3. 切回当前目录执行 pnpm run dev
 *
 * 用法：在任意子工程目录下执行 pnpm start
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve, basename, dirname } from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

// ── 1. 定位 ──
const projectDir     = process.cwd();
const projectDirName = basename(projectDir);
const pkgPath        = resolve(projectDir, 'package.json');
const rootDir        = __dirname;

// ── 2. 修改 package.json 的 name ──
const pkg    = JSON.parse(readFileSync(pkgPath, 'utf-8'));
const oldName = pkg.name || '';
const newName = projectDirName;

if (oldName !== newName) {
    pkg.name = newName;
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
    console.log(`✓ package.json name: "${oldName}" → "${newName}"`);
} else {
    console.log(`✓ package.json name 已是 "${newName}"，无需修改`);
}

// ── 3. 在网站根目录执行 pnpm install ──
console.log(`\n→ 切换到 ${rootDir} 执行 pnpm install ...`);
execSync('pnpm install', { cwd: rootDir, stdio: 'inherit' });

// ── 4. 切回当前目录执行 pnpm run dev ──
console.log(`\n→ 切回 ${projectDir} 启动开发服务器 ...\n`);
try {
    execSync('pnpm run dev', { cwd: projectDir, stdio: 'inherit' });
} catch (e) {
    // vite 被 Ctrl+C 或 timeout 终止时会抛异常，正常退出即可
    process.exit(e.status ?? 0);
}
