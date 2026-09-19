// MF47 型指针式万用表内部电路仿真项目
// 展示经典万用表四种测量模式（直流电流/直流电压/交流电压/电阻）的
// 磁电式表头 + 电阻分压/分流 + 二极管整流的完整工作原理

import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { Multimeter } from '../components/Multimeter.js';
import { AmpMeter } from '../components/AmpMeter.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';

import { MagnetoelectricAmmeter } from '../components/MagnetoelectricAmmeter.js';
import { Resistor } from '../components/Resistor.js';
import { Diode } from '../components/Diode.js';
import { DCPower } from '../components/DCPower.js';
import { Ground } from '../components/Gnd.js';
import { SPDTSwitch } from '../components/SPDTSwitch.js';
import { SP4TSwitch } from '../components/SP4TSwitch.js';
import { UniversalRotarySwitch } from '../components/UniversalRotarySwitch.js';
import { DCCurrent } from '../components/DCCurrent.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';

export const FAULT_CONFIGS = {};

export const PROJECT_WORKFLOWS = {};

export const componentConfigs = [
  // 五种仪表（初始隐藏）
  { Class: Oscilloscope_tri, id: 'osc3', x: 800, y: 160, visible: false },
  { Class: SignalGenerator, id: 'sg', x: 210, y: 200, visible: false },
  { Class: Multimeter, id: 'multimeter', x: 1350, y: 500, visible: false, scale: 1.2 },
  { Class: AmpMeter, id: 'ampmeter', x: 450, y: 100, visible: false },
  { Class: ProcessCalibrator, id: 'cali', x: 600, y: 100, visible: false },

  // 表头（磁电式电流表 46.2μA / 5kΩ）
  {
    Class: MagnetoelectricAmmeter, id: 'mf47-head', x: 620, y: 15,
    label: 'MF47', fullScale: 46.2, unit: 'μA', internalR: 5000, damping: 0.65,
    width: 300, height: 300, scale: 1.3 
  },

  // 直流电流档分流电阻
  { Class: Resistor, id: 'r-sh500ma', x: 380, y: 550, value: 0.462 },
  { Class: Resistor, id: 'r-sh50ma', x: 240, y: 550, value: 4.162 },

  // 直流电压档分压电阻
  { Class: Resistor, id: 'r-dv10', x: 620, y: 550, value: 210000 },
  { Class: Resistor, id: 'r-dv50', x: 760, y: 550, value: 860000 },
  { Class: Resistor, id: 'r-dv250', x: 900, y: 550, value: 4330000 },

  // 开关组件
  {
    Class: SPDTSwitch, id: 'spdt', x: 260, y: 660, label: 'SA', initPosition: 1,
    function: '量程选择', T1Label: '50mA', T2Label: '500mA', scale: 1.2 
  },
  {
    Class: SP4TSwitch, id: 'sp4t', x: 640, y: 640, label: 'SW', position: 0,
    function: '量程选择', labelNames: ['10V', '50V', '250V', '500V'], scale: 1.2
  },
  {
    Class: SPDTSwitch, id: 'spdt2', x: 330, y: 350, label: 'SA', initPosition: 1,
    function: '功能选择', T1Label: 'DCA', T2Label: 'DCV', direction: 'reverse', scale: 1.2 
  },

  // 直流电流源
  { Class: DCCurrent, id: 'dc-current', x: 260, y: 50, label: 'DC Current',currentValue:25 },

  // 接地
  { Class: DCPower, id: 'bat', x: 1080, y: 430, voltage: 5 },
  { Class: Ground, id: 'gnd-ref', x: 680, y: 900 },

   { Class: MF47Multimeter, id: 'mf47-panel', x: 1450, y: 60, rangeMode: 'ACV_500' },
];

export function initSlider(sys) {
}

export function applyAllPresets() {
  const sys = this.sys;
  if (!sys) return;

  // 1. 表头正极 → 功能选择开关 COM
  sys.conns.push({ from: 'mf47-head_wire_l', to: 'spdt2_wire_com', type: 'wire' });

  // 2. 电流路径：spdt2 T1(DCA) → 两个分流电阻 → 电流量程选择开关
  sys.conns.push({ from: 'spdt2_wire_t1', to: 'r-sh50ma_wire_l', type: 'wire' });
  sys.conns.push({ from: 'r-sh50ma_wire_r', to: 'r-sh500ma_wire_l', type: 'wire' });
  sys.conns.push({ from: 'r-sh500ma_wire_r', to: 'mf47-head_wire_r', type: 'wire' });
  // 分流电阻分别接到电流量程选择开关
  sys.conns.push({ from: 'spdt_wire_t2', to: 'r-sh500ma_wire_l', type: 'wire' }); // 500mA
  sys.conns.push({ from: 'spdt_wire_t1', to: 'r-sh50ma_wire_l', type: 'wire' }); // 50mA

  // 3. 电压路径：spdt2 T2(DCV) → 串联3个电阻 → 电压量程选择开关
  sys.conns.push({ from: 'spdt2_wire_t2', to: 'r-dv10_wire_l', type: 'wire' });
  sys.conns.push({ from: 'r-dv10_wire_r', to: 'r-dv50_wire_l', type: 'wire' });
  sys.conns.push({ from: 'r-dv50_wire_r', to: 'r-dv250_wire_l', type: 'wire' });
  // 分压电阻分别接到电压量程选择开关
  sys.conns.push({ from: 'sp4t_wire_t1', to: 'r-dv10_wire_r', type: 'wire' }); // 10V
  sys.conns.push({ from: 'sp4t_wire_t2', to: 'r-dv50_wire_r', type: 'wire' }); // 50V
  sys.conns.push({ from: 'sp4t_wire_t3', to: 'r-dv250_wire_r', type: 'wire' }); // 250V

  //4. 电压源接入电压测量
  sys.conns.push({ from: 'mf47-head_wire_r', to: 'bat_wire_n', type: 'wire' });
  sys.conns.push({ from: 'bat_wire_p', to: 'sp4t_wire_com', type: 'wire' });
  //5. 电流源接入测量
  sys.conns.push({ from: 'mf47-head_wire_r', to: 'dc-current_wire_n', type: 'wire' });
  sys.conns.push({ from: 'dc-current_wire_p', to: 'spdt_wire_com', type: 'wire' });
  sys.redrawAll();
  console.log('[multimeter] applyAllPresets: 自动接线完成');
}

export async function applyStartSystem() {
    const sys = this.sys;
    if (!sys) return;
    if (sys.comps['bat']) {
        sys.comps['bat'].isOn = true;
        sys.comps['bat'].update();
    }
    if (sys.comps['dc-current']) {
        sys.comps['dc-current'].isOn = true;
        sys.comps['dc-current'].update();
    }
    console.log('[multimeter] applyStartSystem: 电压源/电流源已开启');
}

export function fiveStep() {
    const sys = this.sys;
    if (!sys) return;

    const spdt2 = sys.comps['spdt2'];
    const spdt  = sys.comps['spdt'];
    const sp4t  = sys.comps['sp4t'];
    const dc    = sys.comps['dc-current'];
    const bat   = sys.comps['bat'];
    if (!spdt2 || !dc) return;

    const funcPos = spdt2.getPosition(); // 1=T1(DCA), 2=T2(DCV)

    if (funcPos === 1) {
        if (!spdt) return;
        const rangePos = spdt.getPosition();
        let steps;
        if (rangePos === 1) {
            steps = [10, 20, 30, 40, 50, 0];
        } else {
            steps = [100, 200, 300, 400, 500, 0];
        }
        const cur = dc.currentValue;
        let next = steps[0];
        for (const s of steps) {
            if (Math.abs(s - cur) < 1) {
                const idx = steps.indexOf(s);
                next = steps[(idx + 1) % steps.length];
                break;
            }
        }
        dc.currentValue = next;
        dc.update();
    } else {
        if (!sp4t || !bat) return;
        const rangePos = sp4t.getPosition();
        const stepsMap = [
            [2, 4, 6, 8, 10, 0],          
            [2, 4, 6, 8, 10, 0],
            [10, 20, 30, 40, 50, 0],
            [50, 100, 150, 200, 250, 0],
            [100, 200, 300, 400, 500, 0],
        ];
        const steps = stepsMap[rangePos] || stepsMap[0];
        const cur = bat.voltage || 0;
        let next = steps[0];
        for (const s of steps) {
            if (Math.abs(s - cur) < 1) {
                const idx = steps.indexOf(s);
                next = steps[(idx + 1) % steps.length];
                break;
            }
        }
        bat.voltage = next;
        bat.update();
    }
}
