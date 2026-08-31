const fs = require('fs');
const path = require('path');

function searchDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      if (file !== 'node_modules' && file !== '.git') {
        searchDir(fullPath);
      }
    } else {
      if (file.toLowerCase().includes('laporan') || file.toLowerCase().includes('pengeluaran')) {
        console.log(`Found file: ${fullPath}`);
      }
    }
  }
}

searchDir(path.join(__dirname, '..', '..', 'frontend', 'src'));
