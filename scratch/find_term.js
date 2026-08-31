const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'src', 'controller', 'kos.controller.js');
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

console.log('--- Matches for "tanggal_masuk" and "tanggal_keluar" in kos.controller.js ---');
lines.forEach((line, index) => {
  if (line.includes('tanggal_masuk') || line.includes('tanggal_keluar')) {
    console.log(`Line ${index + 1}: ${line.trim()}`);
  }
});
