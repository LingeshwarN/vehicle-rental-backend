require('dotenv').config();
const mysql = require('mysql2');

// Create the connection pool to local XAMPP MySQL database
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'vehicle_rental_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Test the connection
pool.getConnection((err, connection) => {
    if (err) {
        console.error('❌ Database Connection Error:', err.message);
        if (err.code === 'ECONNREFUSED') {
            console.error('👉 Cause: MySQL service is not running in XAMPP. Please open XAMPP Control Panel and click "Start" next to MySQL.');
        } else if (err.code === 'ER_BAD_DB_ERROR') {
            console.error(`👉 Cause: Database "${process.env.DB_NAME || 'vehicle_rental_db'}" does not exist. Create it via phpMyAdmin (http://localhost/phpmyadmin).`);
        } else if (err.code === 'ER_ACCESS_DENIED_ERROR') {
            console.error('👉 Cause: Access denied. Check your DB_USER and DB_PASSWORD in .env.');
        }
    } else {
        console.log('✅ Successfully connected to the MySQL database!');
        connection.release();
    }
});

module.exports = pool;
