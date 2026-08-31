const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'src', 'controller', 'sewa.controller.js');
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

console.log('Searching for functions/exports in sewa.controller.js...');
lines.forEach((line, index) => {
  if (line.includes('exports.') || line.includes('function ')) {
    console.log(`Line ${index + 1}: ${line.trim()}`);
  }
});
