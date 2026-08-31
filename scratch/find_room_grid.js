const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', '..', 'frontend', 'src', 'pages', 'DashboardPemilik.jsx');
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

console.log('Searching for room grid and status_ketersediaan in DashboardPemilik.jsx...');
lines.forEach((line, index) => {
  if (line.includes("kmr.status_ketersediaan === 'terisi'")) {
    console.log(`Line ${index + 1}: ${line.trim()}`);
  }
});
