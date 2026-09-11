import { BaseComponent } from './BaseComponent.js';

/**
 * ShorePowerMainSwitch - 岸电主开关仿真组件（单个三相塑壳断路器）
 * 外观参照低压配电箱中的3路开关中的一个，功能基本一致。
 * 复用求解器 PDB 类型
 */
export class ShorePowerMainSwitch extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.width  = Math.max(120, config.width  || 180);
        this.height = Math.max(150, config.height || 220);
        this.type    = 'PDB';
        this.special = 'ShorePower';
        this.cache   = 'fixed';
        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();
        this.config = { id: this.id, label: this.label, ratedCurrent: this.ratedCurrent,
            shortDelay: this.shortDelay, overloadK: this.overloadK, tripCoilR: this._tripCoilR,
            uvThreshold: this._uvThreshold, ratedCoilVoltage: this._ratedCoilVoltage,
            initState: this._state, animDur: this._animDur };
        this.addPort(this._inPorts[0].x, this._inPorts[0].y, 'in1', 'wire');
        this.addPort(this._inPorts[1].x, this._inPorts[1].y, 'in2', 'wire');
        this.addPort(this._inPorts[2].x, this._inPorts[2].y, 'in3', 'wire');
        this.addPort(this._outPorts[0].x, this._outPorts[0].y, 'sw1_t1', 'wire', 'p');
        this.addPort(this._outPorts[1].x, this._outPorts[1].y, 'sw1_t2', 'wire', 'p');
        this.addPort(this._outPorts[2].x, this._outPorts[2].y, 'sw1_t3', 'wire', 'p');
        this.addPort(this._uvPort.a.x, this._uvPort.a.y, 'sw1_uv1', 'wire', 'p');
        this.addPort(this._uvPort.b.x, this._uvPort.b.y, 'sw1_uv2', 'wire');
        this.addPort(this._ncPort.a.x, this._ncPort.a.y, 'nc1', 'wire');
        this.addPort(this._ncPort.b.x, this._ncPort.b.y, 'nc2', 'wire');
    }

    _recalcGeometry() {
        const W = this.width, H = this.height;
        this._depth = Math.min(8, Math.round(W * 0.028));
        this._dx = this._depth; this._dy = -this._depth;
        this._frame = { x: 2, y: 2, w: W - 4, h: H - 4, rx: 4 };
        this._swCX = 0.58*W;
        this._inPorts = [
            { x: this._swCX - W * 0.20, y: 2 },
            { x: this._swCX, y: 2 },
            { x: this._swCX + W * 0.20, y: 2 }
        ];
        this._outPorts = [
            { x: this._swCX - W * 0.20, y: H - 2 },
            { x: this._swCX, y: H - 2 },
            { x: this._swCX + W * 0.20, y: H - 2 }
        ];
        this._uvPort = { a: { x: W - 2, y: H * 0.30 }, b: { x: W - 2, y: H * 0.50 } };
        this._swTop = H * 0.14; this._swH = H * 0.72; this._swW = W * 0.56;
        this._swInY = this._swTop + 6; this._swOutY = this._swTop + this._swH - 8;
        this._swMidY = (this._swInY + this._swOutY) / 2;
        this._handleBarH = Math.min(this._swH * 0.34, Math.round(H * 0.18));
        this._handleBarW = Math.max(18, Math.min(26, Math.round(this._swW * 0.30)));
        this._handleOffsets = { on: -this._swH * 0.22, off: this._swH * 0.22, trip: 0 };
        this._slotW = this._handleBarW + 10;
        this._slotTop = this._swMidY + this._handleOffsets.on - this._handleBarH / 2 - 4;
        this._slotBot = this._swMidY + this._handleOffsets.off + this._handleBarH / 2 + 4;
        // 左侧常闭辅助触头：贴左边缘垂直排列（a=上 nc1、b=下 nc2），静触柱位于开关面板左侧的窄带内
        this._ncPort = { a: { x: 2, y: Math.round(H * 0.35) }, b: { x: 2, y: Math.round(H * 0.55) } };
        this._ncSx = 26;
    }

    _initParameters(config) {
        this.label = config.label || '岸电主开关';
        this.function = '岸电塑壳断路器';
        this.ratedCurrent = config.ratedCurrent !== undefined ? config.ratedCurrent : 100;
        this.shortDelay = config.shortDelay !== undefined ? config.shortDelay : 0.2;
        this.overloadK = config.overloadK !== undefined ? config.overloadK : 4;
        this._tripCoilR = config.tripCoilR !== undefined ? config.tripCoilR : 200;
        this._uvThreshold = config.uvThreshold !== undefined ? config.uvThreshold : 0.85;
        this._ratedCoilVoltage = config.ratedCoilVoltage !== undefined ? config.ratedCoilVoltage : 24;
        this._animDur = config.animDur !== undefined ? config.animDur : 0.10;
        const s = (config.initState || 'off').toLowerCase();
        this._state = ['on', 'off', 'trip'].includes(s) ? s : 'off';
        this._anim = { animating: false, t: 0, fromY: this._handleOffsets[this._state], toY: this._handleOffsets[this._state], dur: this._animDur };
        this._curHandleY = this._handleOffsets[this._state];
        this._iBuf = [[], [], []]; this._iBufSum = [0, 0, 0];
        for (let ph = 0; ph < 3; ph++) this._iBuf[ph] = new Array(40).fill(0);
        this._iBufIdx = 0; this._iBufCount = 0; this._iRms = [0, 0, 0];
        this._shortT = 0; this._ovAcc = 0; this._animJustEnded = false;
        this._phaseCurrents = { sw1: { l1: 0, l2: 0, l3: 0 } };
        // 求解器回填的瞬时三相电流（PDB 分支写入 dev.phaseCurrents.sw1.l1/l2/l3）
        this.phaseCurrents = this._phaseCurrents;
    }

    _init() { this._drawStaticParts(); this._createDynamicNodes(); this._bindInteraction(); }

    _drawStaticParts() { this._drawBox3D(); this._drawWiring(); this._drawSwitch(); this._drawTerminals(); this._drawNCStatic(); this._drawTitle(); }

    _drawBox3D() {
        const f = this._frame, dx = this._dx, dy = this._dy;
        this._staticGroup.add(new Konva.Line({ points: [f.x+f.w,f.y, f.x+f.w+dx,f.y+dy, f.x+f.w+dx,f.y+f.h+dy, f.x+f.w,f.y+f.h], closed:true, fill:'#9aa2ac', stroke:'#6e7680', strokeWidth:1, listening:false }));
        this._staticGroup.add(new Konva.Line({ points: [f.x,f.y, f.x+dx,f.y+dy, f.x+f.w+dx,f.y+dy, f.x+f.w,f.y], closed:true, fill:'#e3e7ec', stroke:'#c0c6ce', strokeWidth:1, listening:false }));
        this._staticGroup.add(new Konva.Rect({ x:f.x,y:f.y,width:f.w,height:f.h,fill:'#d7dbe0',stroke:'#8a929c',strokeWidth:2,cornerRadius:f.rx }));
        this._staticGroup.add(new Konva.Rect({ x:f.x+3,y:f.y+3,width:f.w-6,height:Math.max(16,Math.round(this.height*0.04)),fill:'rgba(90,120,200,0.16)',cornerRadius:[f.rx,f.rx,0,0] }));
        this._staticGroup.add(new Konva.Line({ points:[f.x+1,f.y+4,f.x+1,f.y+f.h-4],stroke:'rgba(255,255,255,0.35)',strokeWidth:2,listening:false }));
    }

    // 进线端子 → 开关顶部端子、开关底部端子 → 出线端子（三相直连，细线直角折弯，无内部汇流排）
    _drawWiring() {
        const phColors = ['#e03030', '#20a030', '#2050e0'];
        for (let ph = 0; ph < 3; ph++) {
            const inP = this._inPorts[ph];
            const outP = this._outPorts[ph];
            const txIn = this._swCX + (ph - 1) * (this._swW / 3);
            const inY = this._swInY - 4;
            const outY = this._swOutY + 3.5;
            this._staticGroup.add(new Konva.Line({
                points: [inP.x, inP.y + 4, inP.x, inP.y + 10, txIn, inP.y + 10, txIn, inY],
                stroke: phColors[ph], strokeWidth: 1.6, listening: false
            }));
            this._staticGroup.add(new Konva.Line({
                points: [txIn, outY, txIn, outP.y - 6, outP.x, outP.y - 6, outP.x, outP.y - 5],
                stroke: phColors[ph], strokeWidth: 1.4, listening: false
            }));
        }
    }

    _drawSwitch() {
        const cx=this._swCX, x=cx-this._swW/2, y=this._swTop, w=this._swW, h=this._swH;
        this._staticGroup.add(new Konva.Rect({x,y,width:w,height:h,fill:'#f0f1f4',stroke:'#a0a8b8',strokeWidth:1.5,cornerRadius:3}));
        this._staticGroup.add(new Konva.Rect({x:x+2,y:y+2,width:w-4,height:h*0.05,fill:'rgba(255,255,255,0.55)',cornerRadius:[3,3,0,0],listening:false}));
        this._staticGroup.add(new Konva.Rect({x,y,width:2.5,height:h,fill:'#c8ccd4',cornerRadius:[3,0,0,3],listening:false}));
        const slotX=cx-this._slotW/2;
        this._staticGroup.add(new Konva.Rect({x:slotX,y:this._slotTop,width:this._slotW,height:this._slotBot-this._slotTop,fill:'#cfd3da',stroke:'#9aa2ac',strokeWidth:1,cornerRadius:2,listening:false}));
        this._staticGroup.add(new Konva.Rect({x:slotX+1,y:this._slotTop+1,width:this._slotW-2,height:(this._slotBot-this._slotTop)*0.5,fill:'rgba(0,0,0,0.10)',cornerRadius:[2,2,0,0],listening:false}));
        this._staticGroup.add(new Konva.Rect({x:slotX+1,y:this._slotBot-(this._slotBot-this._slotTop)*0.4,width:this._slotW-2,height:(this._slotBot-this._slotTop)*0.4-1,fill:'rgba(255,255,255,0.35)',cornerRadius:[0,0,2,2],listening:false}));
        const lblX=x+3;
        [{off:this._handleOffsets.on,text:'ON',color:'#20a030'},{off:this._handleOffsets.trip,text:'TRIP',color:'#e08020'},{off:this._handleOffsets.off,text:'OFF',color:'#c03020'}].forEach(m=>{
            this._staticGroup.add(new Konva.Text({x:lblX,y:this._swMidY+m.off-5,text:m.text,fontSize:8,fontStyle:'bold',fill:m.color,listening:false}));
        });
        const termYs=[this._swInY,this._swOutY];
        for(let ti=0;ti<2;ti++){for(let ph=0;ph<3;ph++){this._drawScrew(cx+(ph-1)*(w/3),termYs[ti]);}}
        this._staticGroup.add(new Konva.Text({x:cx-w/2,y:y+h+2,width:w,text:'QF',fontSize:10,fontStyle:'bold',fill:'#3a3e44',align:'center',listening:false}));
    }

    _drawScrew(x,y){
        const r=3.5;
        this._staticGroup.add(new Konva.Circle({x,y,radius:r,fillLinearGradientStartPoint:{x:-r,y:-r},fillLinearGradientEndPoint:{x:r,y:r},fillLinearGradientColorStops:[0,'#8a7a30',0.4,'#c8a848',0.7,'#d8b858',1,'#7a6a28'],stroke:'#5a4a18',strokeWidth:0.6,listening:false}));
        this._staticGroup.add(new Konva.Line({points:[x-r*0.55,y,x+r*0.55,y],stroke:'#3a2a08',strokeWidth:0.7,listening:false}));
        this._staticGroup.add(new Konva.Line({points:[x,y-r*0.55,x,y+r*0.55],stroke:'#3a2a08',strokeWidth:0.7,listening:false}));
    }

    _drawTerminals(){
        const phColors=['#e03030','#20a030','#2050e0'];
        this._inPorts.forEach((p,i)=>{this._drawTerminal(p.x,p.y,['L1','L2','L3'][i],phColors[i],true);});
        this._outPorts.forEach((p,i)=>{this._drawTerminal(p.x,p.y,['T1','T2','T3'][i],phColors[i],false);});
        this._drawTerminal(this._uvPort.a.x,this._uvPort.a.y,'失压','#6a5a28',false);
        this._drawTerminal(this._uvPort.b.x,this._uvPort.b.y,'失压','#6a5a28',false);
    }

    _drawTerminal(x,y,name,color,labelRight){
        const R=5;
        this._staticGroup.add(new Konva.Circle({x,y,radius:R,fillLinearGradientStartPoint:{x:-R,y:-R},fillLinearGradientEndPoint:{x:R,y:R},fillLinearGradientColorStops:[0,'#7a6a30',0.4,'#d4aa52',0.7,'#e8c86a',1,'#8a7030'],stroke:'#6a5a28',strokeWidth:1,listening:false}));
        this._staticGroup.add(new Konva.Circle({x,y,radius:R*0.38,fill:'#2a1a08',stroke:'#5a4a20',strokeWidth:0.6,listening:false}));
        this._staticGroup.add(new Konva.Text({x:labelRight?x+8:x-8,y:y-5,text:name,fontSize:8,fontStyle:'bold',fill:color,align:labelRight?'left':'right',listening:false}));
    }

    // 左侧常闭辅助触头静态部分：左缘 nc1/nc2 端口引线（水平到静触柱）+ 上下两个静触头圆点 + “常闭”标注
    _drawNCStatic(){
        const sx=this._ncSx, a=this._ncPort.a, b=this._ncPort.b;
        this._staticGroup.add(new Konva.Line({points:[a.x,a.y,sx,a.y],stroke:'#e03030',strokeWidth:1.5,listening:false}));
        this._staticGroup.add(new Konva.Line({points:[b.x,b.y,sx,b.y],stroke:'#e03030',strokeWidth:1.5,listening:false}));
        this._staticGroup.add(new Konva.Circle({x:sx,y:a.y,radius:4,fill:'#e8c86a',stroke:'#e03030',strokeWidth:0.8,listening:false}));
        this._staticGroup.add(new Konva.Circle({x:sx,y:b.y,radius:4,fill:'#e8c86a',stroke:'#e03030',strokeWidth:0.8,listening:false}));
        this._staticGroup.add(new Konva.Text({x:this._frame.x+4,y:a.y-13,text:'常闭',fontSize:9,fontStyle:'bold',fill:'#c03020',listening:false}));
    }

    _drawTitle(){
        this._staticGroup.add(new Konva.Text({x:this._frame.x+6,y:this._frame.y+6,text:this.label,fontSize:12,fontStyle:'bold',fill:'#3a4a6a',listening:false}));
    }

    _createDynamicNodes(){this._handleGroup=this._createHandle();this._createNCDynamic();}

    _createHandle(){
        const cx=this._swCX, bw=this._handleBarW, bh=this._handleBarH;
        const g=new Konva.Group({x:cx,y:this._swMidY+this._curHandleY});
        g.add(new Konva.Rect({x:-bw/2+2,y:-bh/2+3,width:bw,height:bh,fill:'rgba(0,0,0,0.16)',cornerRadius:3,listening:false}));
        g.add(new Konva.Line({points:[-bw/2,-bh/2, bw/2,-bh/2, bw/2+this._dx*0.22,-bh/2+this._dy*0.22, -bw/2+this._dx*0.22,-bh/2+this._dy*0.22],closed:true,fill:'#14385e',listening:false}));
        g.add(new Konva.Rect({x:-bw/2,y:-bh/2,width:bw,height:bh,fillLinearGradientStartPoint:{x:0,y:-bh/2},fillLinearGradientEndPoint:{x:0,y:bh/2},fillLinearGradientColorStops:[0,'#3890e0',0.3,'#2878c8',0.7,'#1a60a8',1,'#1848a0'],stroke:'#1040a0',strokeWidth:1,cornerRadius:3}));
        g.add(new Konva.Rect({x:-bw/2+3,y:-bh/2+1,width:bw-6,height:bh*0.24,fill:'rgba(255,255,255,0.32)',cornerRadius:[2,2,0,0],listening:false}));
        g.add(new Konva.Line({points:[-bw/2+2,bh/2-1, bw/2-2,bh/2-1],stroke:'rgba(0,0,0,0.25)',strokeWidth:1,listening:false}));
        const gripW=bw-6, gripH=Math.max(11,Math.round(bh*0.24)), gripY=-gripH/2;
        g.add(new Konva.Rect({x:-gripW/2,y:gripY+2,width:gripW,height:gripH,fill:'rgba(0,0,0,0.28)',cornerRadius:2,listening:false}));
        g.add(new Konva.Rect({x:-gripW/2,y:gripY,width:gripW,height:gripH,fillLinearGradientStartPoint:{x:0,y:gripY},fillLinearGradientEndPoint:{x:0,y:gripY+gripH},fillLinearGradientColorStops:[0,'#5aa0ec',0.35,'#3890e0',0.65,'#2a70b8',1,'#18508e'],stroke:'#1040a0',strokeWidth:0.8,cornerRadius:3,listening:false}));
        g.add(new Konva.Rect({x:-gripW/2+2,y:gripY+1,width:gripW-4,height:2,fill:'rgba(255,255,255,0.50)',cornerRadius:1,listening:false}));
        for(let i=0;i<2;i++){const ly=gripY+gripH*0.30+i*4;g.add(new Konva.Line({points:[-gripW*0.34,ly,gripW*0.34,ly],stroke:'rgba(0,0,0,0.20)',strokeWidth:1,listening:false}));}
        this._dynamicGroup.add(g);
        return g;
    }

    // 左侧常闭辅助触头动态触桥：绕下静触头旋转、垂直向上延伸的刀片；主开关合闸→向右偏开（断开），分闸/跳闸→垂直（闭合）
    _createNCDynamic(){
        const sx=this._ncSx, base=this._ncPort.b.y, len=this._ncPort.b.y-this._ncPort.a.y;
        const g=new Konva.Group({x:sx,y:base,rotation:this._state==='on'?25:0,listening:false});
        g.add(new Konva.Line({points:[0,0,0,-len],stroke:'#e03030',strokeWidth:2.5,lineCap:'round',listening:false}));
        g.add(new Konva.Circle({x:0,y:-len,radius:4,fill:'#e8c86a',stroke:'#e03030',strokeWidth:1.5,listening:false}));
        this._dynamicGroup.add(g);
        this._ncBridge=g;
    }

    _bindInteraction(){
        const f=this._frame;
        this._interactGroup.add(new Konva.Rect({x:f.x,y:f.y,width:f.w,height:f.h,fill:'transparent'}));
        const cx=this._swCX;
        const hit=new Konva.Rect({x:cx-this._swW/2,y:this._swTop,width:this._swW,height:this._swH,fill:'transparent'});
        hit.on('click tap',(e)=>{
            e.cancelBubble=true;
            this.sys.lastClickedId=this.id;
            this.sys.lastClickedPartId=this.id+'/sw1';
            if(this._anim.animating)return;
            if(this._state==='off')this.close();
            else if(this._state==='on')this.open();
            else if(this._state==='trip')this._resetToOff();
        });
        hit.on('mouseenter',()=>{document.body.style.cursor='pointer';});
        hit.on('mouseleave',()=>{document.body.style.cursor='default';});
        this._interactGroup.add(hit);
    }

    tick(dt){
        this._tickAnimation(dt);
        this._updateRMS();
        this._checkProtection(dt);
        this._checkUVRelease();
        if(this._anim.animating||this._animJustEnded){
            this._animJustEnded=false;
            this._updateDynamic();
            this.markDirty();
        }
        this._refreshIfDirty();
    }

    // 失压脱扣（非分励）：ON 状态下 uv1↔uv2 电压低于阈值×额定线圈电压 → 跳闸
    _checkUVRelease(){
        if(!this.sys||typeof this.sys.getVoltageBetween!=='function')return;
        if(this._state!=='on')return;
        const v=this.sys.getVoltageBetween(`${this.id}_wire_sw1_uv1`,`${this.id}_wire_sw1_uv2`)||0;
        if(Math.abs(v)<this._uvThreshold*this._ratedCoilVoltage){this.trip();}
    }

    _updateDynamic(){
        this._handleGroup.y(this._swMidY+this._curHandleY);
        if(this._ncBridge)this._ncBridge.rotation(this._state==='on'?25:0);
    }

    _tickAnimation(dt){
        const a=this._anim;
        if(!a.animating)return;
        a.t+=dt/a.dur;
        if(a.t>=1){a.t=1;a.animating=false;this._animJustEnded=true;this._curHandleY=a.toY;}
        const ease=0.5-0.5*Math.cos(a.t*Math.PI);
        this._curHandleY=a.fromY+(a.toY-a.fromY)*ease;
    }

    _updateRMS(){
        const pc=this.phaseCurrents;
        if(!pc||!pc.sw1)return;
        const sw=pc.sw1;
        const inst=[sw.l1||0,sw.l2||0,sw.l3||0];
        for(let ph=0;ph<3;ph++){
            const i2=inst[ph]*inst[ph];
            const old=this._iBuf[ph][this._iBufIdx];
            this._iBuf[ph][this._iBufIdx]=i2;
            this._iBufSum[ph]=this._iBufSum[ph]-old+i2;
        }
        this._iBufIdx=(this._iBufIdx+1)%40;
        if(this._iBufCount<40)this._iBufCount++;
        if(this._iBufCount>=40){for(let ph=0;ph<3;ph++){this._iRms[ph]=Math.sqrt(this._iBufSum[ph]/40);}}
    }

    // 短路 2×In 定时限、过载 1.2×In 反时限（I²t ≈ K/(I/In−1)）
    _checkProtection(dt){
        if(this._iBufCount<40)return;
        const In=this.ratedCurrent;
        if(this._state!=='on'){this._shortT=0;this._ovAcc=0;return;}
        const maxI=Math.max(this._iRms[0],this._iRms[1],this._iRms[2]);
        if(maxI>=2*In){
            this._shortT+=dt;this._ovAcc=0;
            if(this._shortT>=this.shortDelay){this._shortT=0;this.trip();}
        }else if(maxI>=1.2*In){
            this._shortT=0;
            const tI=this.overloadK/(maxI/In-1);
            this._ovAcc+=dt/tI;
            if(this._ovAcc>=1){this._ovAcc=0;this.trip();}
        }else{this._shortT=0;this._ovAcc*=0.96;}
    }

    _startAnim(toState){
        const a=this._anim;
        a.fromY=this._curHandleY;
        a.toY=this._handleOffsets[toState];
        a.t=0;a.animating=true;
        a.dur=toState==='trip'?0.06:this._animDur;
        this._state=toState;
    }

    _resetToOff(){this._anim.dur=0.15;this._startAnim('off');}
    close(){if(this._anim.animating||this._state!=='off')return;this._anim.dur=this._animDur;this._startAnim('on');}
    open(){if(this._anim.animating||this._state!=='on')return;this._anim.dur=this._animDur;this._startAnim('off');}
    trip(){if(this._state==='trip')return;this._anim.dur=0.06;this._startAnim('trip');}

    getSwState(){return this._state;}
    getStates(){return [this._state];}
    isClosed(){return this._state==='on';}
    isTripped(){return this._state==='trip';}
    isAnimating(){return this._anim.animating;}
    getTripCoilR(){return this._tripCoilR;}
    tripSwitch(){this.trip();}
    /** 常闭辅助触头是否闭合：仅当主开关完全合闸到位（ON 且动画结束）才断开；
     *  OFF/TRIP/合闸动画进行中 均视为闭合 —— 避免推闸中途触点过早动作误切断外部回路 */
    isNCClosed(){return !(this._state==='on' && !this._anim.animating);}

    update(state){
        const st=String(state).toLowerCase();
        if(st==='on'||st==='1')this.close();
        if(st==='off'||st==='0')this.open();
        if(st==='trip')this.trip();
    }

    getConfigFields(){
        return [
            {label:'位号/名称',key:'label',type:'text'},
            {label:'额定电流 (A)',key:'ratedCurrent',type:'number'},
            {label:'短路延时 (s)',key:'shortDelay',type:'number'},
            {label:'过载系数 K',key:'overloadK',type:'number'},
            {label:'失压线圈电阻 (Ω)',key:'tripCoilR',type:'number'},
            {label:'失压系数 (缺=0.85)',key:'uvThreshold',type:'number'},
            {label:'失压线圈额定电压 (V)',key:'ratedCoilVoltage',type:'number'},
            {label:'动作时间 (s)',key:'animDur',type:'number'},
        ];
    }

    onConfigUpdate(cfg){
        if(cfg.label!==undefined)this.label=cfg.label;
        if(cfg.ratedCurrent!==undefined)this.ratedCurrent=parseFloat(cfg.ratedCurrent);
        if(cfg.shortDelay!==undefined)this.shortDelay=parseFloat(cfg.shortDelay);
        if(cfg.overloadK!==undefined)this.overloadK=parseFloat(cfg.overloadK);
        if(cfg.tripCoilR!==undefined)this._tripCoilR=parseFloat(cfg.tripCoilR);
        if(cfg.uvThreshold!==undefined)this._uvThreshold=parseFloat(cfg.uvThreshold);
        if(cfg.ratedCoilVoltage!==undefined)this._ratedCoilVoltage=parseFloat(cfg.ratedCoilVoltage);
        if(cfg.animDur!==undefined)this._animDur=parseFloat(cfg.animDur);
        this.config={...this.config,...cfg};
        this._recalcGeometry();
        this._staticGroup.destroyChildren();
        this._dynamicGroup.destroyChildren();
        this._drawStaticParts();
        this._createDynamicNodes();
        this._refreshCache();
    }

    destroy(){super.destroy?.();}
}
