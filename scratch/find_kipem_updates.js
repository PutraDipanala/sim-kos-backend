const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'src', 'controller', 'kos.controller.js');
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

console.log('Searching for UPDATE penghuni_kipem in kos.controller.js...');
lines.forEach((line, index) => {
  if (line.toLowerCase().includes('update') && line.toLowerCase().includes('penghuni_kipem')) {
    console.log(`Line ${index + 1}: ${line.trim()}`);
  }
});
