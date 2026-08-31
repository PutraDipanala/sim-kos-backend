const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'src', 'routes', 'kos.routes.js');
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

console.log('Searching for admin routes in kos.routes.js...');
lines.forEach((line, index) => {
  if (line.includes('admin/stats') || line.includes('admin/penghuni') || line.includes('admin/verify')) {
    console.log(`Line ${index + 1}: ${line.trim()}`);
  }
});
