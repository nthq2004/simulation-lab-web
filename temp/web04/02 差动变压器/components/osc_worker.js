// Worker for Oscilloscope: maintains ring buffers and computes draw points
let bufferSize = 400;
let vHistory, iHistory;
let writePtr = 0;
let renderInterval = 32;
let timeStepFactor = 1;
let isHold = false;
let centerY = -15;

function _resetBuffers() {
    vHistory.fill(centerY);
    iHistory.fill(centerY);
    writePtr = 0;
}

function buildPoints() {
    const vPoints = new Float32Array(bufferSize * 2);
    const iPoints = new Float32Array(bufferSize * 2);
    for (let i = 0; i < bufferSize; i++) {
        const dataIdx = (writePtr + i) % bufferSize;
        const x = -200 + (i / bufferSize) * 400;
        const vi = i * 2;
        vPoints[vi] = x;
        vPoints[vi + 1] = Math.max(-120, Math.min(80, vHistory[dataIdx]));

        iPoints[vi] = x;
        iPoints[vi + 1] = Math.max(-120, Math.min(80, iHistory[dataIdx]));
    }
    // Transfer the underlying buffers for performance
    postMessage({ type: 'points', vPoints, iPoints }, [vPoints.buffer, iPoints.buffer]);
}

let renderTimer = null;

onmessage = function (e) {
    const msg = e.data;
    if (!msg || !msg.type) return;
    if (msg.type === 'init') {
        bufferSize = msg.bufferSize || bufferSize;
        renderInterval = msg.renderInterval || renderInterval;
        timeStepFactor = msg.timeStepFactor || timeStepFactor;
        centerY = (typeof msg.centerY === 'number') ? msg.centerY : centerY;
        vHistory = new Float32Array(bufferSize);
        iHistory = new Float32Array(bufferSize);
        _resetBuffers();
        if (renderTimer) clearInterval(renderTimer);
        renderTimer = setInterval(() => {
            buildPoints();
        }, renderInterval);
        return;
    }

    if (msg.type === 'sample') {
        if (isHold) return;
        const iterCount = msg.iterCount || 0;
        if (iterCount % timeStepFactor !== 0) return;
        const vY = msg.v;
        const iY = msg.i;
        vHistory[writePtr] = vY;
        iHistory[writePtr] = iY;
        writePtr = (writePtr + 1) % bufferSize;
        return;
    }

    if (msg.type === 'command') {
        const cmd = msg.cmd;
        if (cmd === 'clear') {
            _resetBuffers();
            // send an immediate frame after clear
            buildPoints();
        } else if (cmd === 'hold') {
            isHold = !!msg.value;
        } else if (cmd === 'updateScales') {
            timeStepFactor = msg.timeStepFactor || timeStepFactor;
        }
    }
};
