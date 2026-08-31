const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'src', 'routes', 'kos.routes.js');
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

console.log('Searching for owner/dashboard in kos.routes.js...');
lines.forEach((line, index) => {
  if (line.includes('owner/dashboard')) {
    console.log(`Line ${index + 1}: ${line.trim()}`);
  }
});
