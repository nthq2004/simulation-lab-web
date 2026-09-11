// 电子元器件识别与测试仿真工程

import { RealResistor } from '../components/RealResistor.js';
import { RealCapacitor } from '../components/RealCapacitor.js';
import { RealDiode } from '../components/RealDiode.js';
import { RealTransistor } from '../components/RealTransistor.js';
import { RealScr } from '../components/RealScr.js';
import { ElectronicsPanel } from '../components/ElectronicsPanel.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';

export const FAULT_CONFIGS = {
};

export const PROJECT_WORKFLOWS = {
    'electronic-id': {
        id: 'electronic-id',
        name: '1. 电子元器件的识别',
        steps: [
            { msg: '1. 识别电子元器件面板中的电阻元件', mode: 'find', target: 'el-panel', subTarget: 'cell-resistor' },
            { msg: '2. 识别三极管', mode: 'find', target: 'el-panel', subTarget: 'cell-transistor' },
            { msg: '3. 识别晶闸管', mode: 'find', target: 'el-panel', subTarget: 'cell-scr' },
            { msg: '4. 识别电容', mode: 'find', target: 'el-panel', subTarget: 'cell-capacitor' },
            { msg: '5. 识别二极管', mode: 'find', target: 'el-panel', subTarget: 'cell-diode' },
            {
                msg: '6. 测试题：电阻和电容的用途',
                mode: 'quiz',
                quizConfig: {
                    question: '关于电阻和电容的用途，下列说法正确的是？',
                    options: [
                        '电阻用于储存电荷，电容用于限制电流',
                        '电阻限制电流、分配电压，电容储存电荷、滤波和隔直通交',
                        '电阻和电容都只能工作在直流电路中',
                        '电阻的阻值单位是法拉，电容的容量单位是欧姆',
                    ],
                    answer: 1,
                    analysis: '电阻的基本用途是限制电流大小、分配电压（分压），单位为欧姆（Ω）；' +
                        '电容的基本用途是储存电荷，常用于滤波、耦合（隔直通交），容量单位为法拉（F）。',
                },
            },
        ],
    },
    'digital-multimeter-test': {
        id: 'digital-multimeter-test',
        name: '2. 用数字式万用表检测电子元件',
        steps: [
            {
                msg: '1. 测量电阻，在电阻旁填入阻值',
                mode: 'fill',
                target: 'r1',
                fields: [
                    { label: '阻值', unit: 'Ω', answer: 1000, tolerance: 0.05, placeholder: '请输入阻值' },
                ],
            },
            {
                msg: '2. 测量电容，在电容旁填入容量',
                mode: 'fill',
                target: 'c1',
                fields: [
                    { label: '容量', unit: 'uF', answer: 100, tolerance: 0.05, placeholder: '请输入容量' },
                ],
            },
            {
                msg: '3. 测量二极管，填入管压降和引脚顺序',
                mode: 'fill',
                target: 'd1',
                fields: [
                    { label: '管压降', unit: 'V', answer: 0.68, tolerance: 0.02, placeholder: '请输入管压降' },
                    { label: '引脚顺序', answer: 'AK', placeholder: '如 AK或KA' },
                ],
            },
            {
                msg: '4. 检测三极管，填入类型和引脚顺序',
                mode: 'fill',
                target: 't1',
                fields: [
                    { label: '类型', answer: 'NPN', placeholder: '如 NPN或PNP' },
                    { label: '引脚顺序', answer: 'EBC', placeholder: '如 EBC或CBE' },
                ],
            },
            {
                msg: '5. 检测晶闸管，填入引脚顺序',
                mode: 'fill',
                target: 'scr1',
                fields: [
                    { label: '引脚顺序', answer: 'AGK', placeholder: '按上左右的顺序' },
                    { label: 'GK间压降', unit: 'V', answer: 0.68, tolerance: 0.02, placeholder: '请输入GK间正向压降' },
                ],
            },
            {
                msg: '6. 测试题：二极管和三极管的用途',
                mode: 'quiz',
                quizConfig: {
                    question: '关于二极管和三极管的用途，下列说法正确的是？',
                    options: [
                        '二极管具有单向导电性，三极管具有电流放大和开关作用',
                        '二极管用于放大电流，三极管用于整流',
                        '二极管和三极管都是线性器件，阻值固定不变',
                        '二极管的工作单位是法拉，三极管的放大倍数单位是欧姆',
                    ],
                    answer: 0,
                    analysis: '二极管的核心特性是单向导电性，常用于整流、检波、钳位等；' +
                        '三极管（晶体管的俗称）具有电流放大作用和开关作用，是放大电路与数字电路的基本元件。',
                },
            },
        ],
    },
    'mf47-test': {
        id: 'mf47-test',
        name: '3. 用指针式万用表测试电子元件',
        steps: [
            {
                msg: '1. 测量电阻，在电阻旁填入阻值',
                mode: 'fill',
                target: 'r1',
                fields: [
                    { label: '阻值', unit: 'Ω', answer: 1000, tolerance: 0.05, placeholder: '请输入阻值' },
                ],
            },
            {
                msg: '2. 测量电容，在电容旁填入容量',
                mode: 'fill',
                target: 'c1',
                fields: [
                    { label: '容量', unit: 'uF', answer: 100, tolerance: 0.05, placeholder: '请输入容量' },
                ],
            },
            {
                msg: '3. 测量二极管，填入管压降和引脚顺序',
                mode: 'fill',
                target: 'd1',
                fields: [
                    { label: '正向电阻', unit: 'Ω', answer: 1656, tolerance: 0.05, placeholder: '请输入正向电阻' },
                    { label: '引脚顺序', answer: 'AK', placeholder: '如 AK或KA' },
                ],
            },
            {
                msg: '4. 检测三极管，填入类型和引脚顺序',
                mode: 'fill',
                target: 't1',
                fields: [
                    { label: '类型', answer: 'NPN', placeholder: '如 NPN或PNP' },
                    { label: '引脚顺序', answer: 'EBC', placeholder: '如 EBC或CBE' },
                ],
            },
            {
                msg: '5. 检测晶闸管，填入引脚顺序',
                mode: 'fill',
                target: 'scr1',
                fields: [
                    { label: '引脚顺序', answer: 'AGK', placeholder: '按上左右的顺序' },
                    { label: 'GK间电阻', unit: 'Ω', answer: 500, tolerance: 0.1, placeholder: '请输入GK间正向电阻' },
                ],
            },
            {
                msg: '6. 测试题：晶闸管的特征和用途',
                mode: 'quiz',
                quizConfig: {
                    question: '关于晶闸管的特征和用途，下列说法正确的是？',
                    options: [
                        '晶闸管具有单向导电性，门极触发导通后撤去触发信号仍能维持导通',
                        '晶闸管是双向导通器件，可像三极管一样对电流进行连续放大',
                        '晶闸管的门极用于连续调节流过主电路的电流大小',
                        '晶闸管只能工作在直流电路中，不能用于交流电路',
                    ],
                    answer: 0,
                    analysis: '晶闸管（可控硅）具有单向导电性，导通由门极触发控制：' +
                        '门极注入触发电流后晶闸管导通，只要阳极电流大于维持电流，撤去触发信号仍能维持导通（自锁特性）。' +
                        '常用于可控整流、交流调压、无触点开关等场合。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    // ── 左侧：真实元器件，按圆周对称分布（圆心 370,440，半径 330）──
    // 电阻/电容/二极管保持原样不旋转（RealResistor 内部自带 90° 旋转）；三极管、晶闸管向右旋转 90°
    { Class: RealResistor, id: 'r1', x: 370, y: 110, value: 1000, rotation: -90, visible: true, testFlag: true },
    { Class: RealCapacitor, id: 'c1', x: 684, y: 338, capacitance: 100e-6, rotation: 0, visible: true, testFlag: true },
    { Class: RealDiode, id: 'd1', x: 564, y: 707, vForward: 0.68, rotation: 0, visible: true, testFlag: true },
    { Class: RealTransistor, id: 't1', x: 176, y: 707, subType: 'NPN', beta: 100, rotation: 90, visible: true, testFlag: true },
    { Class: RealScr, id: 'scr1', x: 56, y: 338, rotation: 90, visible: true, testFlag: true },

    // ── 右侧：电子元器件面板（800×720，3 行 2 列实物图片）──
    { Class: ElectronicsPanel, id: 'el-panel', x: 850, y: 100, visible: true },

    // ── 6 种保留仪表（默认隐藏，可从"选择仪表"中调出）──
    { Class: Multimeter, id: 'multimeter', x: 880, y: 440, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1050, y: 180, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
];

export function initSlider(_sys) { }

export function applyAllPresets() { }

export async function applyStartSystem() { }

export function fiveStep() { }
