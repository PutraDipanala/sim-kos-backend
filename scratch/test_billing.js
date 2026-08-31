const { generateTagihanInternal } = require('../src/controller/billing.controller');

async function test() {
  try {
    console.log("Menjalankan generateTagihanInternal...");
    const result = await generateTagihanInternal();
    console.log("Hasil:", result);
    process.exit(0);
  } catch (error) {
    console.error("Gagal:", error);
    process.exit(1);
  }
}

test();
