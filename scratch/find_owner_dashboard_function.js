const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'src', 'controller', 'kos.controller.js');
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

console.log('Searching for owner dashboard function in kos.controller.js...');
lines.forEach((line, index) => {
  if (line.includes('owner/dashboard') || line.includes('getOwnerDashboard') || line.includes('exports.getOwner')) {
    console.log(`Line ${index + 1}: ${line.trim()}`);
  }
});
