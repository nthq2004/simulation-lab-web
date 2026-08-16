// 汇总导出所有模块，供 consys.js 一次性引入
// 自动生成的聚合模块 — 如果需要增减模块，请在此文件中修改

// tools
import { Workflow } from './tools/Workflow.js';
import { CircuitSolver } from './tools/CircuitSolver.js';
import { PneumaticSolver } from './tools/PneumaticSolver.js';
import { Show } from './tools/Show.js';
import { perfMonitor } from './tools/PerformanceMonitor.js';
import { DigitalSolver } from './tools/DigitalSolver.js';
import { MicrocontrollerSolver } from './tools/MicrocontrollerSolver.js';
import { MCS51Solver } from './tools/MCS51Solver.js';
import { signalBridge, SignalBridge } from './tools/SignalBridge.js';
import { EventBus } from './tools/EventBus.js';
import { EquipmentPool, EngineRoomEquipment } from './tools/EquipmentPool.js';
import { ThermalSolver } from './tools/ThermalSolver.js';

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
import { DpFlowIndicator } from './components/DpFlowIndicator.js';
import { ImpellerFlowIndicator } from './components/ImpellerFlowIndicator.js';
import { Rotameter } from './components/Rotameter.js';
import { LVDTPressureSensor } from './components/LVDT.js';
import { TempTransmitter } from './components/TempTransmitter.js';
import { PressTransmitter } from './components/PressTransmitter.js';
import { SmartPressTransmitter } from './components/SmartPressTransmitter.js';
import { Rosemount475 } from './components/Rosemount475.js';
import { VoltageTransmitter } from './components/VoltageTransmitter.js';
import { DCPower } from './components/DCPower.js';
import { DCCurrent } from './components/DCCurrent.js';
import { DCVoltage } from './components/DCVoltage.js';
import { AmpMeter } from './components/AmpMeter.js';
import { VariResistor } from './components/VariResistor.js';
import { Resistor } from './components/Resistor.js';
import { Multimeter } from './components/Multimeter.js';
import { MF47Multimeter } from './components/MF47Multimeter.js';
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
import { NpnTempSensor } from './components/NpnTempSensor.js';
import { RealResistor } from './components/RealResistor.js';
import { RealVariResistor } from './components/RealVariResistor.js';
import { RealDiode } from './components/RealDiode.js';
import { Zener } from './components/Zener.js';
import { RealZener } from './components/RealZener.js';
import { LED } from './components/LED.js';
import { RealLED } from './components/RealLED.js';
import { DIAC } from './components/DIAC.js';
import { RealDIAC } from './components/RealDIAC.js';
import { Photodiode } from './components/Photodiode.js';
import { RealPhotodiode } from './components/RealPhotodiode.js';
import { Phototransistor } from './components/Phototransistor.js';
import { RealPhototransistor } from './components/RealPhototransistor.js';
import { CoolingSystem } from './components/CoolingSystem.js';
import { FuelOilHeater } from './components/FuelHeaterSystem.js';
import { PressRelay } from './components/PressRelay.js';
import { AudioVisualAlarm } from './components/AudioVisualAlarm.js';

import { WaterBath } from './components/WaterBath.js';
import { BimetallicThermometer } from './components/Bimetallicthermometer.js';
import { MercuryThermometer } from './components/Mercurythermometer.js';
import { TempMeter } from './components/TempMeter.js';
import { IRThermometer } from './components/IRthermometer.js';
import { BourdonTube } from './components/BourdonTube.js';
import { SCR } from './components/Scr.js';
import { RealScr } from './components/RealScr.js';
import { RealTransistor } from './components/RealTransistor.js';
import { DiaphragmGauge } from './components/DiaphragmGauge.js';
import { IGBT } from './components/IGBT.js';
import { RealIGBT } from './components/RealIGBT.js';
import { Mosfet } from './components/Mosfet.js';
import { RealMosfet } from './components/RealMosfet.js';
import { IncandescentLamp } from './components/IncandescentLamp.js';
import { RealIncandescentLamp } from './components/RealIncandescentLamp.js';
import { IC7805 } from './components/IC7805.js';
import { RealControlTransformer } from './components/RealControlTransformer.js';
import { Switch } from './components/Switch.js';
import { Triac } from './components/Triac.js';
import { RealTriac } from './components/RealTriac.js';
import { Inductor } from './components/Inductor.js';
import { UJT } from './components/ujt.js';
import { RealUJT } from './components/Realujt.js';
import { CurrentTransformer } from './components/CurrentTransformer.js';
import { ACVoltmeter } from './components/ACVoltmeter.js';
import { PotentialTransformer } from './components/PotentialTransformer.js';
import { SinglePhaseFuse } from './components/SinglePhaseFuse.js';
import { NiMHBattery } from './components/NiMHBattery.js';
import { LeadAcidBattery } from './components/LeadAcidBattery.js';
import { SingleLeadAcidBattery } from './components/SingleLeadAcidBattery.js';
import { ChargeBoard } from './components/ChargeBoard.js';
import { SmallLamp } from './components/SmallLamp.js';
import { Hydrometer } from './components/Hydrometer.js';
import { GeneratorFrequencyMeter } from './components/FrequencyMeter.js';
import { DigitalFrequencyMeter } from './components/DigitalFrequencyMeter.js';
import { Wattmeter } from './components/Wattmeter.js';
import { ElecMeter } from './components/ElecMeter.js';
import { PowerFactor } from './components/PowerFactor.js';
import { KwhMeter } from './components/KwhMeter.js';


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

// digital components
import { DigitalBase } from './digital/DigitalBase.js';
import { AND, OR, NOT, NAND, NOR, XOR } from './digital/LogicGates.js';
import { DFlipFlop, JKFlipFlop, ClockGen, Counter } from './digital/Sequential.js';
import { ADC, DAC } from './digital/Interfaces.js';
import { MCU } from './digital/MCU.js';
import { Timer555 } from './digital/Timer555.js';
import { MCS51 } from './digital/MCS51.js';

//new01
import {RealPT100} from './components/RealPT100.js';
import {RealTC} from './components/RealTC.js';
import {ThreeValve} from './components/ThreeValve.js';
import {StrainCylinderSensor} from './components/PressSensor.js';
import { PneumaticValve } from './components/Actuator.js';
import { AirCompressor} from './components/AirCompressor.js';
import { CoolingSys } from './components/CoolingSys.js';
import { NTCThermistor} from './components/NtcThermistor.js';
import { NTCtempTransmitter } from './components/NtctempTransmitter.js';
import { MagneticFlipLevelGauge } from './components/MagneticFlipLevelGauge.js';
import { GlassPlateLevelGauge } from './components/GlassPlateLevelGauge.js';
import { SmartAnalogSwitch } from './components/SmartAnalogSwitch.js';
import { DMMController } from './components/DMMController.js';
import { ConstantCurrentSource } from './components/ConstantCurrentSource.js';
import { GalvanometerHead } from './components/GalvanometerHead.js';
import { ClampMeter } from './components/ClampMeter.js';
import { DigitClampMeter } from './components/DigitClampMeter.js';
import { HallClampMeter } from './components/HallClampMeter.js';
import { Megohmmeter } from './components/Megohmmeter.js';
import { DigitMegohmMeter } from './components/DigitMegohmMeter.js';
import { ACPower3P } from './components/ACPower3P.js';
import { TsCurveDisplay } from './components/TsCurveDisplay.js';
import { ThreePhaseMotor } from './components/ThreePhaseMotor.js';
import { MotorTerminalBox } from './components/MotorTerminalBox.js';
import { InductionMotor } from './components/InductionMotor.js';
import { InductionMotor2 } from './components/InductionMotor2.js';
import { ThreePhaseContactor } from './components/ThreePhaseContactor.js';
import { ContactCurveDisplay } from './components/ContactCurveDisplay.js';
import { ThermalOverloadRelay } from './components/ThermalOverloadRelay.js';
import { ThreePhaseACB } from './components/ThreePhaseACB.js';
import { ThreePhaseACB2 } from './components/ThreePhaseACB2.js';
import { DiagramThreePhaseACB } from './components/DiagramThreePhaseACB.js';
import { DiagramACPower3P } from './components/DiagramACPower3P.js';
import { JSZ3 } from './components/JSZ3.js';
import { JSZ3N } from './components/JSZ3N.js';
import { FluorescentLamp } from './components/FluorescentLamp.js';
import { Ballast } from './components/Ballast.js';
import { Starter } from './components/Starter.js';

import { SealedOilTank } from './components/SealedOilTank.js';

// modbus
import { IASServer } from './modbus/IASServer.js';
import { PLC } from './modbus/PLC.js';
import { ModbusTempTransmitter } from './modbus/TempTransmitter.js';
import { ModbusPressTransmitter } from './modbus/PressTransmitter.js';
import { ModbusVFD } from './modbus/VFD.js';
import { ModbusLevelTransmitter } from './modbus/LevelTransmitter.js';
import { ModbusValvePositioner } from './modbus/ValvePositioner.js';
import { ModbusBUSCON } from './modbus/BUSCON.js';
import { createModbusSystem, ModbusDevice, calcCRC16, FC } from './modbus/MODBUS.js';

// gateway
import { SerialGateway } from './gateway/SerialGateway.js';
import { WebSocketGateway } from './gateway/WebSocketGateway.js';
import { ProtocolAdapter } from './gateway/ProtocolAdapter.js';
import { GatewayController, GatewayPanel } from './gateway/GatewayUI.js';

// device
import { BaseDevice } from './device/BaseDevice.js';
import { DeviceManager } from './device/DeviceManager.js';
import { ContactorDevice } from './device/ContactorDevice.js';
import { ContactorCoil } from './device/ContactorCoil.js';
import { MainContact } from './device/MainContact.js';
import { AuxNOContact } from './device/AuxNOContact.js';
import { AuxNCContact } from './device/AuxNCContact.js';
import { ControlTransformer } from './device/ControlTransformer.js';
import { ThermalRelayDevice } from './device/ThermalRelayDevice.js';
import { ThermalHeatElement } from './device/ThermalHeatElement.js';
import { ThermalNOContact } from './device/ThermalNOContact.js';
import { ThermalNCContact } from './device/ThermalNCContact.js';
import { TimeRelayDevice } from './device/TimeRelayDevice.js';
import { TimeRelayCoil } from './device/TimeRelayCoil.js';
import { TimeDelayNOContact } from './device/TimeDelayNOContact.js';
import { TimeDelayNCContact } from './device/TimeDelayNCContact.js';

// 导出所有聚合的符号
export {
    Workflow, CircuitSolver, PneumaticSolver, Show, perfMonitor,
    DigitalSolver, MicrocontrollerSolver, MCS51Solver, signalBridge, SignalBridge,
    EventBus, EquipmentPool, EngineRoomEquipment, ThermalSolver,
};

export {
    LeakDetector, AirBottle, PressRegulator, PressMeter, TeeConnector, StopValve, Pump, 
    Cooler, Engine,WaterBath,RealPT100,RealTC,
    WaterTankSystem, WaterTankTwoPos, WaterTankLevelControl,
    DiffTransmitter, BubbleLevelTransmitter,
    PIDController, OvenSystem, ElecValve, DpFlowIndicator, ImpellerFlowIndicator, Rotameter,
    LVDTPressureSensor, TempTransmitter, PressTransmitter, SmartPressTransmitter, Rosemount475,
    VoltageTransmitter, DCPower, DCCurrent, DCVoltage, AmpMeter, VariResistor, Resistor, Multimeter, MF47Multimeter, OpAmp, Ground, 
    Monitor, ProcessCalibrator,
    VoltageRelay, ACPower, Oscilloscope_tri, Oscilloscope, SignalGenerator, Capacitor, JFET, 
    Diode, RealDiode, Zener, RealZener, LED, RealLED, DIAC, RealDIAC, Photodiode, RealPhotodiode, Phototransistor, RealPhototransistor, Transistor, NpnTempSensor, RealResistor, RealVariResistor, CoolingSystem,
    FuelOilHeater, PressRelay, AudioVisualAlarm};

export {    
    HistoryManager, ConnectionManager, Renderer, UIManager, WorkflowManager,
    AIModule, AOModule, DIModule, DOModule, CentralComputer, CANBus, createCANSystem, BUSCON
};

export {
    ThreeValve,StrainCylinderSensor,PneumaticValve,AirCompressor,CoolingSys,NTCThermistor,
    NTCtempTransmitter,    BimetallicThermometer,MercuryThermometer,TempMeter,IRThermometer,
    BourdonTube,DiaphragmGauge,SCR,RealScr,RealTransistor,IGBT,RealIGBT,Mosfet,RealMosfet,MagneticFlipLevelGauge,
    GlassPlateLevelGauge,SealedOilTank,SmartAnalogSwitch,DMMController,ConstantCurrentSource,
    GalvanometerHead,ClampMeter,DigitClampMeter,HallClampMeter,
    Megohmmeter,DigitMegohmMeter,ACPower3P,DiagramACPower3P,ThreePhaseMotor,MotorTerminalBox,InductionMotor,InductionMotor2,
    IncandescentLamp,RealIncandescentLamp,RealControlTransformer,Switch,Triac,RealTriac,Inductor,UJT,RealUJT,CurrentTransformer,
    ACVoltmeter,PotentialTransformer,SinglePhaseFuse,NiMHBattery,GeneratorFrequencyMeter,DigitalFrequencyMeter,Wattmeter,ElecMeter,PowerFactor,KwhMeter,
    IC7805,TsCurveDisplay,ThreePhaseContactor,ContactCurveDisplay,ThermalOverloadRelay,ThreePhaseACB,ThreePhaseACB2,DiagramThreePhaseACB,JSZ3,JSZ3N,
    FluorescentLamp,Ballast,Starter,
    SingleLeadAcidBattery, SmallLamp, LeadAcidBattery, ChargeBoard, Hydrometer
};

// modbus exports
export {
    IASServer, PLC,
    ModbusTempTransmitter, ModbusPressTransmitter, ModbusVFD,
    ModbusLevelTransmitter, ModbusValvePositioner,
    ModbusBUSCON, createModbusSystem, ModbusDevice, calcCRC16, FC
};

// gateway exports
export {
    SerialGateway, WebSocketGateway, ProtocolAdapter,
    GatewayController, GatewayPanel,
};

// device exports
export {
    BaseDevice, DeviceManager, ContactorDevice,
    ContactorCoil, MainContact, AuxNOContact, AuxNCContact, ControlTransformer,
    ThermalRelayDevice, ThermalHeatElement, ThermalNOContact, ThermalNCContact,
    TimeRelayDevice, TimeRelayCoil, TimeDelayNOContact, TimeDelayNCContact,
};

// digital exports
export {
    DigitalBase,
    AND, OR, NOT, NAND, NOR, XOR,
    DFlipFlop, JKFlipFlop, ClockGen, Counter,
    ADC, DAC,
    MCU,
    Timer555,
    MCS51,
};

