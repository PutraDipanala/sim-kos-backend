const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'src', 'controller', 'kos.controller.js');
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

console.log('Searching for admin functions in kos.controller.js...');
lines.forEach((line, index) => {
  if (line.includes('admin/stats') || line.includes('admin/penghuni') || line.includes('getAdminStats') || line.includes('getAdminPenghuni') || line.includes('exports.get')) {
    if (line.includes('Penghuni') || line.includes('Stats') || line.includes('admin') || line.includes('Admin')) {
      console.log(`Line ${index + 1}: ${line.trim()}`);
    }
  }
});
