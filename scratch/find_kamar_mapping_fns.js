const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'src', 'controller', 'kos.controller.js');
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

console.log('Searching for id_kamar_fisik assignments in kos.controller.js...');
lines.forEach((line, index) => {
  if (line.includes('id_kamar_fisik') && (line.includes('UPDATE') || line.includes('INSERT') || line.includes('id_kamar_fisik ='))) {
    console.log(`Line ${index + 1}: ${line.trim()}`);
  }
});
