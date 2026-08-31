const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', '..', 'frontend', 'src', 'pages', 'DashboardPemilik.jsx');
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

console.log('Searching for "laporan" or "Laporan" in DashboardPemilik.jsx...');
lines.forEach((line, index) => {
  if (line.toLowerCase().includes('laporan')) {
    console.log(`Line ${index + 1}: ${line.trim()}`);
  }
});
