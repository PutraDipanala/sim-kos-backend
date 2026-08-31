const bcrypt = require("bcrypt");

(async () => {
  const plain = "AdminKos!234"; // password admin
  const hash = await bcrypt.hash(plain, 10);
  console.log(hash);
  process.exit(0);
})();
