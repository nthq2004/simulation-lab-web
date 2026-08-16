const fs = require('fs');
let content = fs.readFileSync('tools/PneumaticSolver.js', 'utf8');

// Remove the bad insertion (outside forEach)
const badStart = content.indexOf('// 电动阀/执行器位置');
if (badStart >= 0) {
  const badEnd = content.indexOf('return conns', badStart);
  content = content.substring(0, badStart) + content.substring(badEnd);
  console.log('Removed bad insertion');
} else {
  console.log('No bad insertion found');
}

// Find the right insertion point - before the forEach closing }); and return conns
const closeMarker = "        });\n\n        return conns";
const closeIdx = content.indexOf(closeMarker);
if (closeIdx < 0) { console.log('Close marker not found'); process.exit(1); }

// Insert the ElecValve check right before the }); line
const insertion = `            // 电动阀/执行器位置 -> 影响流道拓扑
            if (dev.special === 'actuator' && typeof dev.currentPos === 'number') {
                parts.push(\`\${dev.id}:pos=\${dev.currentPos.toFixed(3)}\`);
            }
        `;

content = content.substring(0, closeIdx) + insertion + content.substring(closeIdx);
fs.writeFileSync('tools/PneumaticSolver.js', content, 'utf8');
console.log('OK - ElecValve position inserted inside forEach');
