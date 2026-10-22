/**
 * pageBuilders/index.js — 总导出文件
 *
 * 重新导出所有页面构建函数和辅助函数。
 * 每个页面一个文件，位于 pages/ 子目录下。
 */

// 页面构建函数
export { buildAlarmPage }   from './alarmPage.js';
export { buildParamPage }   from './paramPage.js';
export { buildNetworkPage } from './networkPage.js';
export { buildAISetPage }   from './aiSetPage.js';
export { buildAOPage }      from './aoPage.js';
export { buildDISetPage }   from './diSetPage.js';
export { buildDOPage }      from './doPage.js';
export { buildLevelPage }   from './levelPage.js';
export { buildTempPage }    from './tempPage.js';

// 页面每 tick 刷新函数
export { renderAlarmPage }   from './alarmPage.js';
export { renderParamPage }   from './paramPage.js';
export { renderNetworkPage } from './networkPage.js';
export { renderAISetPage }   from './aiSetPage.js';
export { renderAOPage }      from './aoPage.js';
export { renderDISetPage }   from './diSetPage.js';
export { renderDOPage }      from './doPage.js';
export { renderLevelPage }   from './levelPage.js';
export { renderTempPage }    from './tempPage.js';

// 共享辅助函数
export { isModuleAvailable, applyDoModeUI,mkBtn,mkToggle } from './utils.js';

// 物理过程仿真
export { simLevel } from './levelPage.js';
export { simTemp }  from './tempPage.js';
export { simAlarm }  from './alarmPage.js';
