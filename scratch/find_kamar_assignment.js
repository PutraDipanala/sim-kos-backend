const fs = require('fs');
const path = require('path');

function searchDir(dir, term) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      if (file !== 'node_modules' && file !== '.git') {
        searchDir(fullPath, term);
      }
    } else {
      if (file.endsWith('.js')) {
        const content = fs.readFileSync(fullPath, 'utf8');
        if (content.includes(term)) {
          console.log(`Found "${term}" in: ${fullPath}`);
        }
      }
    }
  }
}

console.log('Searching for "id_kamar_fisik" in backend...');
searchDir(path.join(__dirname, '..', 'src'), 'id_kamar_fisik');
