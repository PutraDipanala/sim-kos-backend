require('dotenv').config();
const mysql = require('mysql2');

const pool = mysql.createPool({
  host: 'mysql.railway.internal',     // Sesuai nilai MYSQLHOST di layar
  port: 3306,                         // Port default MySQL Railway internal
  user: 'root',                       // Sesuai MYSQLUSER
  password: 'WByQSZhcNRmwESmrcWaVVQeQXrPWPXJn', // Sesuai MYSQL_ROOT_PASSWORD di layar
  database: 'railway',                // Sesuai MYSQL_DATABASE
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

module.exports = pool.promise();