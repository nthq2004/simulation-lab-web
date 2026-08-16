// 汇总导出所有模块，供 consys.js 一次性引入
// 自动生成的聚合模块 — 如果需要增减模块，请在此文件中修改

// tools
import { Workflow } from './tools/Workflow.js';
import { CircuitSolver } from './tools/CircuitSolver.js';
import { PneumaticSolver } from './tools/PneumaticSolver.js';
import { Show } from './tools/Show.js';
import { perfMonitor } from './tools/PerformanceMonitor.js';

// components
import { LeakDetector } from './components/LeakDetector.js';
import { AirBottle } from './components/AirBottle.js';
import { PressRegulator } from './components/PressRegulator.js';
import { PressMeter } from './components/PressMeter.js';
import { TeeConnector } from './components/TeeConnector.js';
import { StopValve } from './components/StopValve.js';
import { Pump } from './components/Pump.js';
import { Cooler } from './components/Cooler.js';
import { Engine } from './components/Engine.js';
import { WaterTankSystem } from './components/WatertankSystem.js';
import { WaterTankTwoPos } from './components/WaterTankTwoPos.js';
import { WaterTankLevelControl } from './components/WaterTankLevelControl.js';
import { DiffTransmitter } from './components/DiffTransmitter.js';
import { BubbleLevelTransmitter } from './components/BubbleLevelTransmitter.js';
import { PIDController } from './components/PID.js';
import { OvenSystem } from './components/OvenSystem.js';
import { ElecValve } from './components/ElecValve.js';
import { LVDTPressureSensor } from './components/LVDT.js';
import { TempTransmitter } from './components/TempTransmitter.js';
import { PressTransmitter } from './components/PressTransmitter.js';
import { SmartPressTransmitter } from './components/SmartPressTransmitter.js';
import { Rosemount475 } from './components/Rosemount475.js';
import { VoltageTransmitter } from './components/VoltageTransmitter.js';
import { DCPower } from './components/DCPower.js';
import { AmpMeter } from './components/AmpMeter.js';
import { VariResistor } from './components/VariResistor.js';
import { Resistor } from './components/Resistor.js';
import { Multimeter } from './components/Multimeter.js';
import { OpAmp } from './components/OpAmp.js';
import { Ground } from './components/Gnd.js';
import { Monitor } from './components/Monitor.js';
import { ProcessCalibrator } from './components/ProcessCalibrator.js';
import { VoltageRelay } from './components/VoltageRelay.js';
import { ACPower } from './components/ACPower.js';
import { Oscilloscope_tri } from './components/Osc_tri.js';
import { Oscilloscope } from './components/Oscilloscope.js';
import { SignalGenerator } from './components/SignalGenerator.js';
import { Capacitor } from './components/Capacitor.js';
import { JFET } from './components/JFET.js';
import { Diode } from './components/Diode.js';
import { Transistor } from './components/Transistor.js';
import { RealResistor } from './components/RealResistor.js';
import { RealVariResistor } from './components/RealVariResistor.js';
import { CoolingSystem } from './components/CoolingSystem.js';
import { FuelOilHeater } from './components/FuelHeaterSystem.js';
import { PressRelay } from './components/PressRelay.js';
import { AudioVisualAlarm } from './components/AudioVisualAlarm.js';
import { NormallyClosedPushButton } from './components/ButtonStop.js';
import { NormallyOpenPushButton } from './components/ButtonStart.js';
import { WaterBath } from './components/WaterBath.js';

// lib
import { HistoryManager } from './lib/HistoryManager.js';
import { ConnectionManager } from './lib/ConnectionManager.js';
import { Renderer } from './lib/Renderer.js';
import { UIManager } from './lib/UIManager.js';
import { WorkflowManager } from './lib/WorkflowManager.js';

// can
import { AIModule } from './can/AI.js';
import { AOModule } from './can/AO.js';
import { DIModule } from './can/DI.js';
import { DOModule } from './can/DO.js';
import { CentralComputer } from './can/CentralComputer.js';
import { CANBus, createCANSystem } from './can/CANBUS.js';
import { BUSCON } from './can/BUSCON.js';

//new01
import {RealPT100} from './components/RealPT100.js';
import {RealTC} from './components/RealTC.js';
import {ThreeValve} from './components/ThreeValve.js';
import {StrainCylinderSensor} from '/components/PressSensor.js';
import { PneumaticValve } from './components/Actuator.js';
import { AirCompressor} from './components/AirCompressor.js';

// 导出所有聚合的符号
export {
    Workflow, CircuitSolver, PneumaticSolver, Show, perfMonitor
};

export {
    LeakDetector, AirBottle, PressRegulator, PressMeter, TeeConnector, StopValve, Pump, Cooler, Engine,WaterBath,RealPT100,RealTC,
    WaterTankSystem, WaterTankTwoPos, WaterTankLevelControl,
    DiffTransmitter, BubbleLevelTransmitter,
    PIDController, OvenSystem, ElecValve,
    LVDTPressureSensor, TempTransmitter, PressTransmitter, SmartPressTransmitter, Rosemount475,
    VoltageTransmitter, DCPower, AmpMeter, VariResistor, Resistor, Multimeter, OpAmp, Ground, Monitor, ProcessCalibrator,
    VoltageRelay, ACPower, Oscilloscope_tri, Oscilloscope, SignalGenerator, Capacitor, JFET, Diode, Transistor, RealResistor, RealVariResistor, CoolingSystem,
    FuelOilHeater, PressRelay, AudioVisualAlarm, NormallyClosedPushButton, NormallyOpenPushButton};

export {    
    HistoryManager, ConnectionManager, Renderer, UIManager, WorkflowManager,
    AIModule, AOModule, DIModule, DOModule, CentralComputer, CANBus, createCANSystem, BUSCON
};

export {    
    ThreeValve,StrainCylinderSensor,PneumaticValve,AirCompressor,
};

