// 船舶发电机主开关仿真工程（同步发电机 + 汇流排 + 船用框架式空气断路器）

import { SyncGenerator3P } from '../components/SyncGenerator3P.js';
import { Busbar3P } from '../components/Busbar3P.js';
import { MarineMainsSwitch } from '../components/MarineMainsSwitch.js';
import { DCPower } from '../components/DCPower.js';
import { Ground } from '../components/Gnd.js';
import { DiagramStartButton } from '../components/DiagramStartButton.js';
import { DiagramStopButton } from '../components/DiagramStopButton.js';
import { InductionMotor2 } from '../components/InductionMotor2.js';
import { IncandescentLamp } from '../components/IncandescentLamp.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { RealMegohmMeter } from '../components/RealMegohmMeter.js';
import { DistributionBox } from '../components/DistributionBox.js';
import { ThreePhaseLoad } from '../components/ThreePhaseLoad.js';
import { InsulationIndicator } from '../components/InsulationIndicator.js';
import { InsulationMonitor } from '../components/InsulationMonitor.js';

export const FAULT_CONFIGS = {
    // ── 动力电网绝缘低：三路负载随机选一路、该路三相随机选一相，绝缘设为 0.05 MΩ ──
    insul_low: {
        id: 'insul_low',
        name: '动力电网绝缘低',
        system: '绝缘监测',
        _pick: null,   // { ld, ph } 本次故障选中的负载与相
        trigger() {
            const insul = window.sys?.comps?.['insul'];
            if (!insul) return;
            const ld = Math.floor(Math.random() * 3);   // 0电机/1照明/2可调
            const ph = Math.floor(Math.random() * 3);   // 0A/1B/2C
            this._pick = { ld, ph };
            insul.setLoadInsul(ld, ph, 0.05e6);          // 0.05 MΩ
        },
        repair() {
            const insul = window.sys?.comps?.['insul'];
            if (!insul || !this._pick) return;               // 未设置故障时不做任何恢复，避免误改 (0,0) 相
            insul.setLoadInsul(this._pick.ld, this._pick.ph, 100e6);   // 恢复 100 MΩ
            this._pick = null;
        },
        check() {
            const insul = window.sys?.comps?.['insul'];
            if (!insul || !this._pick) return false;
            const v = insul.getLoadInsul(this._pick.ld, this._pick.ph);
            return isFinite(v) && v > 0 && v <= 0.05e6;   // 0.05 MΩ
        },
    },
    // ── 动力电网接地：三路负载随机选一路、该路三相随机选一相，绝缘设为 0（对地短路） ──
    insul_ground: {
        id: 'insul_ground',
        name: '动力电网接地',
        system: '绝缘监测',
        _pick: null,
        trigger() {
            const insul = window.sys?.comps?.['insul'];
            if (!insul) return;
            const ld = Math.floor(Math.random() * 3);
            const ph = Math.floor(Math.random() * 3);
            this._pick = { ld, ph };
            insul.setLoadInsul(ld, ph, 0);                 // 对地短路
        },
        repair() {
            const insul = window.sys?.comps?.['insul'];
            if (!insul || !this._pick) return;               // 未设置故障时不做任何恢复，避免误改 (0,0) 相
            insul.setLoadInsul(this._pick.ld, this._pick.ph, 100e6);   // 恢复 100 MΩ
            this._pick = null;
        },
        check() {
            const insul = window.sys?.comps?.['insul'];
            if (!insul || !this._pick) return false;
            return insul.getLoadInsul(this._pick.ld, this._pick.ph) === 0;
        },
    },
};

// ═══════════════════════════════════════════════════════════════════
// 操作流程
//   自动演示（show/step）下，每个 check 步骤用 op 数组拆分为若干子操作，
//   逐个演示：箭头指示目标部件（含浮动提示）→ 执行 act() → 间隔，便于学员
//   看清每一步点击/操作对应的部件与效果。op.type 取值：
//     'wire'  工具栏「自动接线」  'switch' 开关/断路器/按钮
//     'btn'   组件按钮           'knob'   旋钮
//     'fault' 工具栏「故障设置」  'instrument' 工具栏「选择仪表」
//     'observe' 观察/无点击动作（箭头指向目标组件）
// ═══════════════════════════════════════════════════════════════════

export const PROJECT_WORKFLOWS = {
    // ── 用仪表确认动力电网绝缘低故障与接地故障 ──
    'insul-detect': {
        id: 'insul-detect',
        name: '1. 用仪表确认动力电网绝缘故障',
        steps: [
            {
                /**
                 * 第 1 步：接线，起动同步发电机，合上主开关（储能－合闸），
                 * 合上配电箱三路负载开关，为三灯绝缘指示灯与绝缘监视仪供电。
                 */
                msg: '第 1 步：自动接线，起动发电机，手动合闸，依次合上三路负载开关。',
                mode: 'check',
                op: [
                    { type: 'wire', msg: '点击工具栏「自动接线」按钮，完成主回路与控制回路接线',
                      async act() {
                          _autoWire(this.sys);
                          this.sys.showFloatingTip('已自动接线', 1500);
                          await _sleep(700);
                      } },
                    { type: 'switch', target: 'gen1', part: 'start', msg: '点击同步发电机「机旁起动」按钮，起动发电机',
                      async act() {
                          const gen = this.sys.comps.gen1;
                          if (gen) gen.isOn = true;
                          this.sys.showFloatingTip('同步发电机已起动', 1500);
                          await _sleep(700);
                      } },
                    { type: 'switch', target: 'qf1', part: 'btn-close', msg: '储能后点击主开关「合闸」按钮，合上主开关',
                      async act() {
                          _qfChargeClose(this.sys);
                          this.sys.showFloatingTip('主开关已合闸', 1500);
                          await _sleep(900);
                      } },
                    { type: 'switch', target: 'pdb1', part: 'sw1', msg: '合上配电箱负载开关 1（电机）',
                      async act() { const p = this.sys.comps.pdb1; if (p) p.close(0); await _sleep(700); } },
                    { type: 'switch', target: 'pdb1', part: 'sw2', msg: '合上配电箱负载开关 2（照明）',
                      async act() { const p = this.sys.comps.pdb1; if (p) p.close(1); await _sleep(700); } },
                    { type: 'switch', target: 'pdb1', part: 'sw3', msg: '合上配电箱负载开关 3（三相可调负载）',
                      async act() { const p = this.sys.comps.pdb1; if (p) p.close(2); await _sleep(700); } },
                ],
                check() {
                    const gen = this.sys.comps.gen1;
                    const qf = this.sys.comps.qf1;
                    const pdb = this.sys.comps.pdb1;
                    return gen && gen.isOn
                        && qf && qf.getState() === 'on'
                        && pdb && pdb.isClosed(0) && pdb.isClosed(1) && pdb.isClosed(2);
                },
            },
            {
                /** 第 2 步：触发动力电网绝缘低故障 */
                msg: '第 2 步：触发「动力电网绝缘低」故障。绝缘监视仪读数下降至约 0.05MΩ，触发声光报警。',
                mode: 'check',
                op: [
                    { type: 'fault', fault: 'insul_low', msg: '设置「动力电网绝缘低」故障',
                      async act() {
                          const fc = this.sys.FAULT_CONFIG && this.sys.FAULT_CONFIG['insul_low'];
                          if (fc && !fc.check()) fc.trigger();
                          await _sleep(700);
                      } },
                ],
                check() {
                    const fc = this.sys.FAULT_CONFIG && this.sys.FAULT_CONFIG['insul_low'];
                    return fc && fc.check();
                },
            },
            {
                /** 第 3 步：观察读数并消音、消闪 */
                msg: '第 3 步：观察绝缘监视仪读数。依次按下「消音」、「消闪」。',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'insulmon', msg: '观察绝缘监视仪读数下降，声光报警启动',
                      async act() {
                          const fc = this.sys.FAULT_CONFIG && this.sys.FAULT_CONFIG['insul_low'];
                          if (fc && !fc.check()) fc.trigger();       // 确保故障仍生效
                          const im = this.sys.comps.insulmon;
                          if (im) {
                              im._badTime = im._alarmDelay;           // 立即进入报警锁存
                              im._latched = true;
                              im._flashOff = false;
                          }
                          await _sleep(900);
                      } },
                    { type: 'btn', target: 'insulmon', part: 'btn-mute', msg: '按下绝缘监视仪「消音」按钮',
                      async act() {
                          const im = this.sys.comps.insulmon;
                          if (im) im._pressButton('mute');              // 消音
                          await _sleep(700);
                      } },
                    { type: 'btn', target: 'insulmon', part: 'btn-flash', msg: '按下绝缘监视仪「消闪」按钮，报警灯转常亮',
                      async act() {
                          const im = this.sys.comps.insulmon;
                          if (im) im._pressButton('flash');             // 消闪
                          await _sleep(700);
                      } },
                ],
                check() {
                    const im = this.sys.comps.insulmon;
                    const fc = this.sys.FAULT_CONFIG && this.sys.FAULT_CONFIG['insul_low'];
                    return im && im.isAlarming() && im.isMuted() && im.isFlashOff()
                        && fc && fc.check();
                },
            },
            {
                /** 第 4 步：按下绝缘指示灯测试按钮进行测试 */
                msg: '第 4 步：按下绝缘指示灯的「测试」按钮。灯泡亮度没有变化。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'insul', part: 'btn', msg: '按下绝缘指示灯「测试」按钮（接入三灯绝缘检测回路）',
                      async act() {
                          const insul = this.sys.comps.insul;
                          if (insul) insul.setButtonLocked(true);
                          await _sleep(900);
                      } },
                ],
                check() {
                    const insul = this.sys.comps.insul;
                    return insul && insul.isButtonClosed();
                },
            },
            {
                /** 第 5 步：复位绝缘低故障，复位报警灯 */
                msg: '第 5 步：复位「动力电网绝缘低」故障。按下「复位」，报警灯熄灭、报警解除。',
                mode: 'check',
                op: [
                    { type: 'fault', fault: 'insul_low', repair: true,
                      msg: '打开「故障设置」，取消勾选「动力电网绝缘低」并应用设置，修复故障（绝缘恢复 100MΩ）',
                      async act() {
                          const fcLow = this.sys.FAULT_CONFIG && this.sys.FAULT_CONFIG['insul_low'];
                          if (fcLow && fcLow._pick) fcLow.repair();         // 兜底：面板操作未生效则直接修复
                          const insul = this.sys.comps.insul;
                          if (insul) insul.setButtonLocked(false);          // 断开测试按钮，恢复常态观察
                          _refreshInsulMonitor(this.sys);                   // 刷新 minR 使复位条件成立
                          await _sleep(800);
                      } },
                    { type: 'btn', target: 'insulmon', part: 'btn-reset', msg: '按下「复位」按钮，解除报警锁存，报警灯熄灭',
                      async act() {
                          const im = this.sys.comps.insulmon;
                          if (im) {
                              im._flashOff = false;
                              im._pressButton('reset');                    // 满足条件时解除锁存，熄灭报警灯
                          }
                          await _sleep(700);
                      } },
                ],
                check() {
                    const fcLow = this.sys.FAULT_CONFIG && this.sys.FAULT_CONFIG['insul_low'];
                    const im = this.sys.comps.insulmon;
                    const lowRepaired = !fcLow || fcLow._pick === null;
                    return im && !im.isAlarming() && !im.isMuted() && lowRepaired;
                },
            },
            {
                /** 第 6 步：触发接地故障并消音消闪 */
                msg: '第 6 步：触发「动力电网接地」故障。绝缘监视仪读数降至 0MΩ，重新触发声光报警（快闪＋蜂鸣）。依次按下「消音」「消闪」，报警灯转为常亮锁定。',
                mode: 'check',
                op: [
                    { type: 'fault', fault: 'insul_ground', msg: '设置「动力电网接地」故障（对地短路，读数降至 0MΩ）',
                      async act() {
                          const fcGnd = this.sys.FAULT_CONFIG && this.sys.FAULT_CONFIG['insul_ground'];
                          if (fcGnd && !fcGnd.check()) fcGnd.trigger();    // 触发接地故障（面板未生效时兜底）
                          const im = this.sys.comps.insulmon;
                          if (im) {
                              im._badTime = im._alarmDelay;                // 立即进入报警锁存
                              im._latched = true;
                              im._flashOff = false;
                          }
                          await _sleep(900);
                      } },
                    { type: 'btn', target: 'insulmon', part: 'btn-mute', msg: '按下「消音」按钮',
                      async act() {
                          const im = this.sys.comps.insulmon;
                          if (im) im._pressButton('mute');
                          await _sleep(700);
                      } },
                    { type: 'btn', target: 'insulmon', part: 'btn-flash', msg: '按下「消闪」按钮，报警灯转为常亮锁定',
                      async act() {
                          const im = this.sys.comps.insulmon;
                          if (im) im._pressButton('flash');
                          await _sleep(700);
                      } },
                ],
                check() {
                    const im = this.sys.comps.insulmon;
                    const fcGnd = this.sys.FAULT_CONFIG && this.sys.FAULT_CONFIG['insul_ground'];
                    return im && im.isAlarming() && im.isMuted() && im.isFlashOff()
                        && fcGnd && fcGnd.check();
                },
            },
            {
                /** 第 7 步：测试按钮检测接地相 */
                msg: '第 7 步：再次按下绝缘指示灯「测试」按钮。接地相（对地短路）灯应完全熄灭，其余两相仍亮。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'insul', part: 'btn', msg: '再次按下绝缘指示灯「测试」按钮，观察故障相灯熄灭',
                      async act() {
                          const insul = this.sys.comps.insul;
                          if (insul) insul.setButtonLocked(true);
                          await _sleep(900);
                      } },
                ],
                check() {
                    const insul = this.sys.comps.insul;
                    const fcGnd = this.sys.FAULT_CONFIG && this.sys.FAULT_CONFIG['insul_ground'];
                    return insul && insul.isButtonClosed() && fcGnd && fcGnd.check();
                },
            },
            {
                /** 第 8 步：修复接地故障并复位报警灯 */
                msg: '第 8 步：修复「动力电网接地」故障，绝缘监视仪读数恢复正常。按下「复位」，报警灯熄灭、报警解除。',
                mode: 'check',
                op: [
                    { type: 'fault', fault: 'insul_ground', repair: true,
                      msg: '打开「故障设置」，取消勾选「动力电网接地」并应用设置，修复故障（绝缘恢复 100MΩ）',
                      async act() {
                          const fcGnd = this.sys.FAULT_CONFIG && this.sys.FAULT_CONFIG['insul_ground'];
                          if (fcGnd && fcGnd._pick) fcGnd.repair();     // 兜底：面板操作未生效则直接修复
                          const insul = this.sys.comps.insul;
                          if (insul) insul.setButtonLocked(false);    // 断开测试按钮
                          _refreshInsulMonitor(this.sys);             // 刷新 minR 使复位条件成立
                          await _sleep(800);
                      } },
                    { type: 'btn', target: 'insulmon', part: 'btn-reset', msg: '按下「复位」按钮，报警解除、报警灯熄灭',
                      async act() {
                          const im = this.sys.comps.insulmon;
                          if (im) {
                              im._flashOff = false;
                              im._pressButton('reset');               // 满足条件时解除锁存
                          }
                          await _sleep(700);
                      } },
                ],
                check() {
                    const im = this.sys.comps.insulmon;
                    const fcGnd = this.sys.FAULT_CONFIG && this.sys.FAULT_CONFIG['insul_ground'];
                    const gndRepaired = !fcGnd || fcGnd._pick === null;
                    return im && !im.isAlarming() && !im.isMuted() && gndRepaired;
                },
            },
            {
                msg: '第 9 步：测试题——绝缘指示灯的工作原理',
                mode: 'quiz',
                quizConfig: {
                    question: '船舶三灯绝缘指示灯的原理是：三相绕组（或负载）接成星形，中性点经一个常开按钮接地。按下测试按钮后，三灯串联接于三相与地之间。当某相绝缘良好时，其灯电压接近相电压、灯较亮；当某相发生对地绝缘下降（或接地）时，该相与地之间电阻变小、分压降低，灯变暗或熄灭。判断故障相的依据是？',
                    options: [
                        '灯最亮的那一相是故障相',
                        '灯变暗或熄灭的那一相是故障相',
                        '所有灯亮度相同即正常，无法判断故障相',
                        '灯的颜色决定故障相',
                    ],
                    answer: 1,
                    analysis: '绝缘指示灯将三相电源经三灯星形连接、中性点经测试按钮接地。正常时三灯经星点等电位，亮度相近；当某相对地绝缘下降或接地时，该相灯两端分压减小，灯变暗甚至熄灭，而其他相仍正常发光。因此，变暗或熄灭的灯对应故障相。',
                },
            },
            {
                msg: '第 10 步：测试题——绝缘监视仪的工作原理',
                mode: 'quiz',
                quizConfig: {
                    question: '绝缘监视仪（如 500V 等级）的工作原理是不断向被测电网（经注入电容）注入一个低频测量脉冲信号，并在仪表内部串接待测绝缘电阻，通过检测该回路产生的泄漏电流，利用「内部串联电阻与绝缘电阻分压」的关系，反算出被测电网的绝缘电阻值。以下说法正确的是？',
                    options: [
                        '注入的脉冲用于给电网提供有功功率',
                        '泄漏电流越大，说明绝缘电阻越高',
                        '利用内部电阻与绝缘电阻串联分压，由泄漏电流换算出绝缘电阻',
                        '绝缘监视仪直接测量电网电压幅值即可判断绝缘',
                    ],
                    answer: 2,
                    analysis: '绝缘监视仪通过注入低频脉冲，使测量回路形成「仪表内阻＋被测绝缘电阻」的串联通路，泄漏电流随绝缘电阻降低而增大。仪表依据分压关系由泄漏电流换算出绝缘电阻：绝缘电阻越小，泄漏电流越大，读数越低；当绝缘电阻低于阈值（如 0.1MΩ）时发出声光报警。',
                },
            },
        ],
    },

    // ── 电网绝缘故障的查找（拉电查找法 + 兆欧表复核）──
    'insul-find': {
        id: 'insul-find',
        name: '2. 电网绝缘故障的查找',
        steps: [
            {
                /**
                 * 第 1 步：接线，起动同步发电机，合上主开关（储能－合闸），
                 * 合上配电箱三路负载开关（电机／照明／可调负载）。
                 */
                msg: '第 1 步：自动接线，起动同步发电机，手动合闸供电，依次合上三路负载开关。',
                mode: 'check',
                op: [
                    { type: 'wire', msg: '点击工具栏「自动接线」按钮，完成主回路与控制回路接线',
                      async act() {
                          _autoWire(this.sys);
                          this.sys.showFloatingTip('已自动接线', 1500);
                          await _sleep(700);
                      } },
                    { type: 'switch', target: 'gen1', part: 'start', msg: '点击同步发电机「机旁起动」按钮，起动发电机',
                      async act() {
                          const gen = this.sys.comps.gen1;
                          if (gen) gen.isOn = true;
                          this.sys.showFloatingTip('同步发电机已起动', 1500);
                          await _sleep(700);
                      } },
                    { type: 'switch', target: 'qf1', part: 'btn-close', msg: '储能后点击主开关「合闸」按钮，合上主开关',
                      async act() {
                          _qfChargeClose(this.sys);
                          this.sys.showFloatingTip('主开关已合闸', 1500);
                          await _sleep(900);
                      } },
                    { type: 'switch', target: 'pdb1', part: 'sw1', msg: '合上配电箱负载开关 1（电机）',
                      async act() { const p = this.sys.comps.pdb1; if (p) p.close(0); await _sleep(700); } },
                    { type: 'switch', target: 'pdb1', part: 'sw2', msg: '合上配电箱负载开关 2（照明）',
                      async act() { const p = this.sys.comps.pdb1; if (p) p.close(1); await _sleep(700); } },
                    { type: 'switch', target: 'pdb1', part: 'sw3', msg: '合上配电箱负载开关 3（三相可调负载）',
                      async act() { const p = this.sys.comps.pdb1; if (p) p.close(2); await _sleep(700); } },
                ],
                check() {
                    const gen = this.sys.comps.gen1;
                    const qf = this.sys.comps.qf1;
                    const pdb = this.sys.comps.pdb1;
                    return gen && gen.isOn
                        && qf && qf.getState() === 'on'
                        && pdb && pdb.isClosed(0) && pdb.isClosed(1) && pdb.isClosed(2);
                },
            },
            {
                /** 第 2 步：触发动力电网绝缘低故障 */
                msg: '第 2 步：触发「动力电网绝缘低」故障。绝缘监视仪读数下降至约 0.05MΩ，触发声光报警。',
                mode: 'check',
                op: [
                    { type: 'fault', fault: 'insul_low', msg: '设置「动力电网绝缘低」故障',
                      async act() {
                          const fc = this.sys.FAULT_CONFIG && this.sys.FAULT_CONFIG['insul_low'];
                          if (fc && !fc.check()) fc.trigger();
                          await _sleep(700);
                      } },
                ],
                check() {
                    const fc = this.sys.FAULT_CONFIG && this.sys.FAULT_CONFIG['insul_low'];
                    return fc && fc.check();
                },
            },
            {
                /** 第 3 步：消音、消闪 */
                msg: '第 3 步：按下绝缘监视仪「消音」「消闪」，报警灯转为常亮。',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'insulmon', msg: '观察绝缘监视仪读数下降，声光报警启动',
                      async act() {
                          const fc = this.sys.FAULT_CONFIG && this.sys.FAULT_CONFIG['insul_low'];
                          if (fc && !fc.check()) fc.trigger();       // 确保故障仍生效
                          const im = this.sys.comps.insulmon;
                          if (im) {
                              im._badTime = im._alarmDelay;           // 立即进入报警锁存
                              im._latched = true;
                              im._flashOff = false;
                          }
                          await _sleep(900);
                      } },
                    { type: 'btn', target: 'insulmon', part: 'btn-mute', msg: '按下绝缘监视仪「消音」按钮',
                      async act() {
                          const im = this.sys.comps.insulmon;
                          if (im) im._pressButton('mute');
                          await _sleep(700);
                      } },
                    { type: 'btn', target: 'insulmon', part: 'btn-flash', msg: '按下绝缘监视仪「消闪」按钮，报警灯转常亮',
                      async act() {
                          const im = this.sys.comps.insulmon;
                          if (im) im._pressButton('flash');
                          await _sleep(700);
                      } },
                ],
                check() {
                    const im = this.sys.comps.insulmon;
                    const fc = this.sys.FAULT_CONFIG && this.sys.FAULT_CONFIG['insul_low'];
                    return im && im.isAlarming() && im.isMuted() && im.isFlashOff()
                        && fc && fc.check();
                },
            },
            {
                /**
                 * 第 4 步：拉电查找法。逐路拉掉负载开关：当拉到故障路时，
                 * 该相总绝缘不再包含故障负载，绝缘监视仪读数恢复正常，
                 * 据此判定该路负载绝缘低。
                 */
                msg: '第 4 步：使用「拉电查找法」——依次拉掉各路负载开关。当拉掉某路开关时绝缘监视仪读数恢复正常，即可判定该路负载绝缘低。',
                mode: 'check',
                op: [
                    { type: 'switch', target: 'pdb1',
                      // 按当前故障实际所在路，动态确定要拉开的开关部件
                      part() {
                          const fc = this.sys.FAULT_CONFIG && this.sys.FAULT_CONFIG['insul_low'];
                          const ld = (fc && fc._pick) ? fc._pick.ld : 0;
                          return 'sw' + (ld + 1);
                      },
                      msg: '拉开故障路负载开关（拉电查找法）',
                      async act() {
                          const fc = this.sys.FAULT_CONFIG && this.sys.FAULT_CONFIG['insul_low'];
                          const pdb = this.sys.comps.pdb1;
                          if (fc && fc._pick && pdb) pdb.open(fc._pick.ld);   // 拉掉故障路
                          await _sleep(1200);
                          // 拉掉故障路后，刷新绝缘监视仪读数（故障相不再并联故障负载）
                          _refreshInsulMonitor(this.sys);
                          this.sys.showFloatingTip('拉掉该路后读数恢复 → 判定该路负载绝缘低', 2000);
                          await _sleep(600);
                      } },
                ],
                check() {
                    const fc = this.sys.FAULT_CONFIG && this.sys.FAULT_CONFIG['insul_low'];
                    const pdb = this.sys.comps.pdb1;
                    const im = this.sys.comps.insulmon;
                    if (!fc || !fc._pick || !pdb) return false;
                    const faultLd = fc._pick.ld;
                    // 故障路已被拉掉（断开），且绝缘监视仪读数恢复正常（min 回阈值以上）
                    const faultPathDisconnected = !pdb.isClosed(faultLd);
                    const recovered = im && im.getMinResistance() >= im._threshold;
                    return faultPathDisconnected && recovered;
                },
            },
            {
                /**
                 * 第 5 步：挂检修牌，调出手摇兆欧表测量绝缘。
                 * 兆欧表 L 接故障负载某相端子、E 接船体地，摇动手柄，
                 * 联动绝缘指示灯模式测得该负载三相绝缘最小（0.05MΩ）。
                 */
                msg: '第 5 步：在配电箱上挂上「禁止合闸，有人工作」检修牌。调出手摇兆欧表，L 端接故障负载一相端子、E 端接地，摇动手柄测量绝缘，读数应约为 0.05MΩ（绝缘低）。',
                mode: 'check',
                op: [
                    { type: 'instrument', instrument: 'megohm', msg: '从工具栏「选择仪表」菜单调出手摇兆欧表',
                      async act() {
                          const megger = this.sys.comps.megohm;
                          if (megger) megger.show();
                          this.sys.showFloatingTip('已调出手摇兆欧表', 1500);
                          await _sleep(800);
                      } },
                    { type: 'observe', target: 'megohm', part: 'l', msg: '兆欧表 L 端接故障负载一相端子、E 端接船体地（动画接线）',
                      async act() {
                          const fc = this.sys.FAULT_CONFIG && this.sys.FAULT_CONFIG['insul_low'];
                          // 根据故障负载与相选择相线端子（L 端接入）
                          let lPort = 'im01_wire_u1';
                          if (fc && fc._pick) {
                              const ld = fc._pick.ld, ph = fc._pick.ph;
                              if (ld === 0) lPort = ['im01_wire_u1', 'im01_wire_v1', 'im01_wire_w1'][ph];
                              else if (ld === 1) lPort = ['lamp1_wire_l', 'lamp2_wire_l', 'lamp3_wire_l'][ph];
                              else if (ld === 2) lPort = ['tload_wire_l1', 'tload_wire_l2', 'tload_wire_l3'][ph];
                          }
                          await _connectMegohm(this.sys, lPort, 'gnd_l_wire_gnd');   // 动画接线
                          this.sys.showFloatingTip('L/E 端接线完成', 1500);
                          await _sleep(500);
                      } },
                    { type: 'switch', target: 'megohm', part: 'crank', msg: '摇动手柄测量绝缘，等待指针稳定在约 0.05MΩ（绝缘低）后再进入下一步',
                      async act() {
                          const megger = this.sys.comps.megohm;
                          if (!megger) return;
                          // 演示中临时加快指针响应，使读数能在数秒内稳定到故障值（结束后恢复）
                          const prevTau = megger._rampTime;
                          megger._rampTime = Math.min(prevTau, 0.3);
                          megger.setCranking(true);
                          // 依据本次故障相的实际绝缘值，等待兆欧表读数稳定后才继续
                          const fc = this.sys.FAULT_CONFIG && this.sys.FAULT_CONFIG['insul_low'];
                          const insul = this.sys.comps.insul;
                          let expected = 0.05;
                          if (fc && fc._pick && insul) expected = insul.getLoadInsul(fc._pick.ld, fc._pick.ph) / 1e6;
                          const ok = await _waitMegohmStable(megger, expected, 20000);
                          megger._rampTime = prevTau;
                          this.sys.showFloatingTip(ok
                              ? `兆欧表读数已稳定在约 ${expected.toFixed(2)}MΩ（绝缘低）`
                              : '兆欧表测量完成', 2000);
                          await _sleep(400);
                      } },
                ],
                check() {
                    const megger = this.sys.comps.megohm;
                    const fc = this.sys.FAULT_CONFIG && this.sys.FAULT_CONFIG['insul_low'];
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return megger && megger.isCranking()
                        && fc && fc.check()
                        && (c('megohm_wire_l', 'im01_wire_u1') || c('megohm_wire_l', 'im01_wire_v1')
                            || c('megohm_wire_l', 'im01_wire_w1') || c('megohm_wire_l', 'lamp1_wire_l')
                            || c('megohm_wire_l', 'lamp2_wire_l') || c('megohm_wire_l', 'lamp3_wire_l')
                            || c('megohm_wire_l', 'tload_wire_l1') || c('megohm_wire_l', 'tload_wire_l2')
                            || c('megohm_wire_l', 'tload_wire_l3'))
                        && megger.getResistance() < 1;   // 测到绝缘低（MΩ < 1）
                },
            },
            {
                /** 第 6 步：修复电网绝缘故障，复位报警 */
                msg: '第 6 步：修复「动力电网绝缘低」故障，合回故障路负载开关。按下「复位」，报警解除、报警灯熄灭。',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'megohm', part: 'crank', msg: '停止摇表并拆下兆欧表接线',
                      async act() {
                          const megger = this.sys.comps.megohm;
                          if (megger) { megger.setCranking(false); megger.hide(); }
                          _disconnectMegohm(this.sys);
                          await _sleep(700);
                      } },
                    { type: 'fault', fault: 'insul_low', repair: true,
                      msg: '打开「故障设置」，取消勾选「动力电网绝缘低」并应用设置，修复故障（绝缘恢复 100MΩ）',
                      async act() {
                          const fc = this.sys.FAULT_CONFIG && this.sys.FAULT_CONFIG['insul_low'];
                          if (fc && fc._pick) fc.repair();         // 兜底：面板操作未生效则直接修复
                          const pdb = this.sys.comps.pdb1;
                          if (pdb) { pdb.close(0); pdb.close(1); pdb.close(2); }   // 合回三路负载开关
                          _refreshInsulMonitor(this.sys);
                          await _sleep(800);
                      } },
                    { type: 'btn', target: 'insulmon', part: 'btn-reset', msg: '按下「复位」按钮，报警解除、报警灯熄灭',
                      async act() {
                          const im = this.sys.comps.insulmon;
                          if (im) {
                              im._flashOff = false;
                              im._pressButton('reset');            // 满足条件时解除锁存
                          }
                          await _sleep(700);
                      } },
                ],
                check() {
                    const fc = this.sys.FAULT_CONFIG && this.sys.FAULT_CONFIG['insul_low'];
                    const im = this.sys.comps.insulmon;
                    const pdb = this.sys.comps.pdb1;
                    const lowRepaired = !fc || fc._pick === null;
                    return im && !im.isAlarming() && !im.isMuted() && lowRepaired
                        && pdb && pdb.isClosed(0) && pdb.isClosed(1) && pdb.isClosed(2);
                },
            },
            {
                /** 第 7 步：测试题——故障查找方法 */
                msg: '第 7 步：测试题——负载分路由多个支路组成时，采用的故障查找方法',
                mode: 'quiz',
                quizConfig: {
                    question: '动力电网中某路负载（如照明）由多个支路组成，各支路分别经开关供电。当该路出现绝缘故障时，用于确定具体故障支路的查找方法是？',
                    options: [
                        '逐段测量电流的「电流分析法」',
                        '逐支路拉闸、观察绝缘监视仪读数是否恢复的「拉电查找法」',
                        '将所有支路同时断电后重新合闸',
                        '直接拆开所有接线逐一目测',
                    ],
                    answer: 1,
                    analysis: '当负载分路由多个支路组成时，常用「拉电查找法」：依次断开某一支路的开关（拉电），观察绝缘监视仪读数是否恢复正常——若拉到某一支路时读数恢复，说明该支路即为绝缘故障支路；若拉开后读数仍低，则继续排查下一支路。此法安全、快速，可逐级缩小故障范围。',
                },
            },
            {
                /** 第 8 步：测试题——动力电网与照明电网查找区别 */
                msg: '第 8 步：测试题——动力电网与照明电网查找具体分路绝缘故障的区别',
                mode: 'quiz',
                quizConfig: {
                    question: '查找动力电网与照明电网的绝缘故障时，操作方式的区别是？',
                    options: [
                        '两者都是直接拉开关',
                        '照明电网是直接拉（照明）开关断电查找；动力电网因负载为电动机，只要停机则电动机断电',
                        '动力电网可直接带电机拉开关，照明电网必须停电机',
                        '两者操作方法完全相同',
                    ],
                    answer: 1,
                    analysis: '照明电网由多个照明支路开关供电，可直接拉照明开关（短路一段支路、断电）来逐级排查绝缘故障支路。而动力电网负载为电动机等大功率设备，直接拉开负载开关会在带载时产生较大工况变化甚至电弧，因此必须先停机（停电机）——即先停止电动机、使负载断电。两者排查手法相似（拉电/断电观察），但动力电网强调「先停电机再操作」。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    // ── 主回路：同步发电机 → 主开关 → 汇流排 ──
    { Class: SyncGenerator3P, id: 'gen1', x: -60, y: 700, vRms: 230, freq: 50, isOn: false, label: '同步发电机', ratedPower: 80, ratedVoltage: 80, ratedCosPhi: 0.8, rOn: 0.05, avrDelay: 3, avrTime: 5, maxDropV: 80, avrMaxComp: 1, visible: true },
    { Class: MarineMainsSwitch, id: 'qf1', x: -150, y: 220, ratedCtrlVoltage: 24, label: '主开关',  visible: true },
    // ── 控制端子共用地 ──
    // 主开关线圈（储能电机 m / 合闸 c / 失压 uv / 分励 fl）的负极公共接地
    { Class: Ground, id: 'gnd_qf', x: 460, y: 580, visible: true },
    // 直流 24V 电源负极接地
    { Class: Ground, id: 'gnd_dc', x: 1080, y: 420, visible: true },
    // 主开关控制按钮：停止按钮（红、NC）、起动按钮（绿、NO）与合闸按钮（绿、NO）
    { Class: DiagramStopButton, id: 'sb', x: 680, y: 360, label: '模拟失压', visible: true },
    { Class: DiagramStartButton, id: 'ss', x: 760, y: 440, label: '分闸', visible: true },
    { Class: DiagramStartButton, id: 'sc', x: 600, y: 280, label: '合闸', visible: true },
    { Class: Busbar3P, id: 'bus1', x: 220, y: 30, tapsPerPhase: 6, label: '汇流排', visible: true },

    // ── 控制电源（DC 24V）：失压脱扣线圈 ──
    { Class: DCPower, id: 'dc_uv', x: 980, y: 150, voltage: 24, isOn: true, label: '失压脱扣电源', visible: true },

    // ── 汇流排馈出支路 ──
    // 支路1：配电箱开关1 → 三相感应电机（Y 接法）
    { Class: InductionMotor2, id: 'im01', x: 1080, y: 730, visible: true,
        R1: 0.50, Lsigma1: 0.00334, Rc: 300, Lm: 0.0796,
        R2: 0.46, Lsigma2: 0.00334,
        J: 0.12, B: 0.01, polePairs: 2,
        ratedPower: 10, ratedSpeed: 1440,
        simpleModel: true, loadTorque: 20 },
    // 支路2：配电箱开关2 → 三盏白炽灯（分别接 L1/L2/L3，r 端星形互联后接地）
    { Class: IncandescentLamp, id: 'lamp1', x: 1330, y: 770, coldResistance: 4.84, rotation: 90 },
    { Class: IncandescentLamp, id: 'lamp2', x: 1400, y: 770, coldResistance: 4.84, rotation: 90 },
    { Class: IncandescentLamp, id: 'lamp3', x: 1470, y: 770, coldResistance: 4.84, rotation: 90 },
    { Class: Ground, id: 'gnd_l', x: 800, y: 990, visible: true },

    // 支路3：配电箱开关3 → 三相可调负载（星形，中性点 n 接地）
    { Class: ThreePhaseLoad, id: 'tload', x: 1530, y: 650, powerKw: 20, cosPhi: 1, reactive: 'ind', loaded: false, label: '三相可调负载', visible: true },

    { Class: Multimeter, id: 'multimeter', x: 820, y: 100, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 950, y: 150, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: -50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: -50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: -50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: -50, y: 50, visible: false },
    // ── 手摇兆欧表：联动绝缘指示灯模式（不显示实测值，按 L 端接点映射绝缘读数）──
    { Class: RealMegohmMeter, id: 'megohm', x: 1420, y: 700, label: '手摇兆欧表',
        insulSync: true, visible: false },

    // ── 低压三相配电箱（汇流排供电，出线接电机与照明）──
    { Class: DistributionBox, id: 'pdb1', x: 1200, y: 190, label: '低压配电箱', ratedCurrent: 100, shortDelay: 0.2, overloadK: 4, tripCoilR: 200, initStates: ['off', 'off', 'off'], visible: true },

    // ── 船舶三灯绝缘指示灯（检测母线各相对船体绝缘）──
    // loadInsul: 3 路负载（电机/照明/可调负载）× 3 相（A/B/C）绝缘电阻（Ω）
    { Class: InsulationIndicator, id: 'insul', x: 400, y: 620, label: '绝缘指示灯',
        loadInsul: [[100e6, 100e6, 100e6], [100e6, 100e6, 100e6], [100e6, 100e6, 100e6]],
        lampOK: [true, true, true], visible: true },

    // ── 绝缘监视仪（读取绝缘指示灯三相等效值，<0.1MΩ 声光报警）──
    { Class: InsulationMonitor, id: 'insulmon', x: 720, y: 580, label: '绝缘监视仪',
        alarmThreshold: 0.1, insulSourceId: 'insul', visible: true },
];

// ─── 接线辅助 ───

function _autoWire(sys) {
    sys.conns.length = 0;
    const cons = [
        // ── 主回路：同步发电机 → 主开关 → 汇流排 ──
        { from: 'gen1_wire_u', to: 'qf1_wire_t1', type: 'wire' },
        { from: 'gen1_wire_v', to: 'qf1_wire_t2', type: 'wire' },
        { from: 'gen1_wire_w', to: 'qf1_wire_t3', type: 'wire' },
        { from: 'qf1_wire_l1', to: 'bus1_wire_l1_1', type: 'wire' },
        { from: 'qf1_wire_l2', to: 'bus1_wire_l2_1', type: 'wire' },
        { from: 'qf1_wire_l3', to: 'bus1_wire_l3_1', type: 'wire' },
        // 直流 24V 电源负极接地
        { from: 'dc_uv_wire_n', to: 'gnd_dc_wire_gnd', type: 'wire' },
        // ── 支路：配电箱进线（汇流排三相）→ 开关1→电机、开关2→照明 ──
        { from: 'bus1_wire_l1_8', to: 'pdb1_wire_in1', type: 'wire' },
        { from: 'bus1_wire_l2_8', to: 'pdb1_wire_in2', type: 'wire' },
        { from: 'bus1_wire_l3_8', to: 'pdb1_wire_in3', type: 'wire' },
        // 开关1 → 感应电机（Y 接法）
        { from: 'pdb1_wire_sw1_t1', to: 'im01_wire_u1', type: 'wire' },
        { from: 'pdb1_wire_sw1_t2', to: 'im01_wire_v1', type: 'wire' },
        { from: 'pdb1_wire_sw1_t3', to: 'im01_wire_w1', type: 'wire' },
        { from: 'im01_wire_u2', to: 'im01_wire_v2', type: 'wire' },
        { from: 'im01_wire_v2', to: 'im01_wire_w2', type: 'wire' },
        // 开关2 → 三盏白炽灯（L1/L2/L3 各一），r 端星形互联（不接地，浮空星点）
        { from: 'pdb1_wire_sw2_t1', to: 'lamp1_wire_l', type: 'wire' },
        { from: 'pdb1_wire_sw2_t2', to: 'lamp2_wire_l', type: 'wire' },
        { from: 'pdb1_wire_sw2_t3', to: 'lamp3_wire_l', type: 'wire' },
        // 三盏白炽灯中性点星形连接：r 端互联（不接地，配合绝缘指示灯形成对地绝缘检测回路）
        { from: 'lamp1_wire_r', to: 'lamp2_wire_r', type: 'wire' },
        { from: 'lamp2_wire_r', to: 'lamp3_wire_r', type: 'wire' },
        // 开关3 → 三相可调负载（星形，中性点 n 不接地）
        { from: 'pdb1_wire_sw3_t1', to: 'tload_wire_l1', type: 'wire' },
        { from: 'pdb1_wire_sw3_t2', to: 'tload_wire_l2', type: 'wire' },
        { from: 'pdb1_wire_sw3_t3', to: 'tload_wire_l3', type: 'wire' },
        // ── 绝缘指示灯：三相并联母线（=下缘取用 l1_4/l2_4/l3_4），地端口经内部常开检测按钮接船体地 ──
        { from: 'bus1_wire_l1_4', to: 'insul_wire_l1', type: 'wire' },
        { from: 'bus1_wire_l2_4', to: 'insul_wire_l2', type: 'wire' },
        { from: 'bus1_wire_l3_4', to: 'insul_wire_l3', type: 'wire' },
        { from: 'insul_wire_gnd', to: 'gnd_l_wire_gnd', type: 'wire' },
        // ── 绝缘监视仪：顶部三相端口并联母线（与绝缘指示灯同 tap），底部地端口接船体地 ──
        { from: 'bus1_wire_l1_4', to: 'insulmon_wire_l1', type: 'wire' },
        { from: 'bus1_wire_l2_4', to: 'insulmon_wire_l2', type: 'wire' },
        { from: 'bus1_wire_l3_4', to: 'insulmon_wire_l3', type: 'wire' },
        { from: 'insulmon_wire_gnd', to: 'gnd_l_wire_gnd', type: 'wire' },
        // ── 控制回路：DC 24V 正极 → 停止按钮 SB1（常闭 NC）→ 失压脱扣线圈 uv → 公共地
        //    停止按钮用于正常停机：按下断开 → 失压线圈断电 → 主开关分闸
        { from: 'dc_uv_wire_p', to: 'sb_wire_nc4', type: 'wire' },
        { from: 'sb_wire_nc3', to: 'qf1_wire_uv1', type: 'wire' },
        { from: 'qf1_wire_uv2', to: 'gnd_qf_wire_gnd', type: 'wire' },
        // ── 控制回路：DC 24V 正极 → 起动按钮 SB2（常开 NO）→ 分励脱扣线圈 fl → 公共地
        //    按下起动按钮（闭合）→ 分励线圈得电 → 主开关分闸
        { from: 'dc_uv_wire_p', to: 'ss_wire_no2', type: 'wire' },
        { from: 'ss_wire_no1', to: 'qf1_wire_fla', type: 'wire' },
        { from: 'qf1_wire_flb', to: 'gnd_qf_wire_gnd', type: 'wire' },
        // ── 控制回路：DC 24V 正极 → 合闸按钮 SB3（常开 NO）→ 合闸线圈 c1 → 公共地 ──
        //    按下合闸按钮（闭合）→ 合闸线圈得电 → 主开关合闸
        { from: 'dc_uv_wire_p', to: 'sc_wire_no2', type: 'wire' },
        { from: 'sc_wire_no1', to: 'qf1_wire_c1', type: 'wire' },
        // ── 储能电机电源：DC 24V 正极 → 主开关储能电机（m1/m2），负极 → 公共地 ──
        { from: 'dc_uv_wire_p', to: 'qf1_wire_m1', type: 'wire' },
        { from: 'qf1_wire_m2', to: 'gnd_qf_wire_gnd', type: 'wire' },
        // ── 主开关合闸线圈负极 → 公共地 ──
        { from: 'qf1_wire_c2', to: 'gnd_qf_wire_gnd', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

export function initSlider(_sys) {
}

export function applyAllPresets() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    _autoWire(sys);
}

export async function applyStartSystem() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    _autoWire(sys);
    // 起动发电机
    const gen = sys.comps.gen1;
    if (gen) gen.isOn = true;
}

export function fiveStep() {
}

// ─── 工作流辅助函数 ───

const _sleep = ms => new Promise(r => setTimeout(r, ms));

/** 判断两个端口是否处于同一电路簇 */
function _sameCluster(sys, portA, portB) {
    const map = sys.voltageSolver && sys.voltageSolver.portToCluster;
    if (!map) return false;
    const cA = map.get(portA);
    const cB = map.get(portB);
    return cA !== undefined && cA === cB;
}

/** 移除多对连线 */
function _removeConnPairs(sys, pairs) {
    const conns = sys.conns || [];
    pairs.forEach(([a, b]) => {
        conns.filter(c => c.type === 'wire' &&
            ((c.from === a && c.to === b) || (c.from === b && c.to === a)))
            .forEach(c => sys.connMgr.removeConn(c));
    });
    sys.redrawAll();
}

/** 新增多对连线 */
function _addConnPairs(sys, pairs) {
    pairs.forEach(([a, b]) => {
        sys.connMgr.addConn({ from: a, to: b, type: 'wire' });
    });
    sys.redrawAll();
}

/** 兆欧表接线：清除旧连线，再以「动画接线」依次连 L→lPort、E→ePort（每条约 3s） */
async function _connectMegohm(sys, lPort, ePort) {
    const l = 'megohm_wire_l';
    const e = 'megohm_wire_e';
    const conns = sys.conns || [];
    conns.filter(c => c.type === 'wire' &&
        (c.from === l || c.to === l || c.from === e || c.to === e))
        .forEach(c => sys.connMgr.removeConn(c));
    sys.redrawAll();
    if (typeof sys.addConnectionAnimated === 'function') {
        await sys.addConnectionAnimated({ from: l, to: lPort, type: 'wire' });
        await sys.addConnectionAnimated({ from: e, to: ePort, type: 'wire' });
    } else {
        sys.connMgr.addConn({ from: l, to: lPort, type: 'wire' });
        sys.connMgr.addConn({ from: e, to: ePort, type: 'wire' });
    }
    sys.redrawAll();
}

/** 兆欧表拆线 */
function _disconnectMegohm(sys) {
    const l = 'megohm_wire_l';
    const e = 'megohm_wire_e';
    const conns = sys.conns || [];
    conns.filter(c => c.type === 'wire' &&
        (c.from === l || c.to === l || c.from === e || c.to === e))
        .forEach(c => sys.connMgr.removeConn(c));
    sys.redrawAll();
}

/**
 * 等待兆欧表读数稳定在 expected（MΩ）附近：
 * 连续若干次采样都落在容差内，视为指针已稳定；超时返回 false。
 * @param {object} megger RealMegohmMeter 组件
 * @param {number} expected 期望读数（MΩ）
 * @param {number} [timeout] 最长等待时间 ms
 */
async function _waitMegohmStable(megger, expected, timeout = 20000) {
    if (!megger || !isFinite(expected)) return false;
    const tol = Math.max(0.003, expected * 0.06);   // 容差：0.05MΩ → ±0.003MΩ
    let stable = 0;
    const start = Date.now();
    while (Date.now() - start < timeout) {
        await _sleep(120);
        const r = megger.getResistance();
        if (isFinite(r) && Math.abs(r - expected) <= tol) {
            if (++stable >= 5) return true;         // 连续约 0.6s 处于容差内 → 稳定
        } else {
            stable = 0;
        }
    }
    return false;
}

/** 故障修复后强制刷新绝缘监视仪三相读数与最小值，使复位条件（minR≥阈值）成立 */
function _refreshInsulMonitor(sys) {
    const im = sys.comps && sys.comps.insulmon;
    if (!im) return;
    const src = im.sys && im.sys.comps ? im.sys.comps[im._insulSourceId] : null;
    if (src && typeof src.getInsulResistance === 'function') {
        for (let i = 0; i < 3; i++) {
            const v = src.getInsulResistance(i);
            im._R[i] = (isFinite(v) && v >= 0) ? v : 1e9;
        }
    }
    im._minR = Math.min(im._R[0], im._R[1], im._R[2]);
}

/** 主开关储能满后合闸（自动恢复储能电机供电） */
function _qfChargeClose(sys) {
    const qf = sys.comps['qf1'];
    if (!qf) return;
    // 储能电机供电（m1/m2 已有自动储能），若未储能则直接补满
    if (!qf.isCharged()) { qf._chargeProg = 5; qf._charged = true; }
    if (qf.getState() === 'off') qf.tryClose();
}
