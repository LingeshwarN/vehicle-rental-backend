const express = require('express');
const mysql = require('mysql2');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken'); 

const app = express();
app.use(express.json());

// Secret key for signing tokens (In production, use process.env.JWT_SECRET)
const JWT_SECRET = 'my_super_secret_key_12345';

// 1. Database Connection
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'vehicle_rental_db'
});

db.connect((err) => {
    if (err) {
        console.error('❌ Database Connection Error:');
        console.error('👉 Cause: MySQL service is not running in XAMPP. Please open XAMPP Control Panel and click "Start" next to MySQL.');
        return;
    }
    console.log('✅ Database Connected Successfully!');
});


// ==========================================
// SECURITY MIDDLEWARE (The Bouncer)
// ==========================================
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; 

    if (!token) {
        return res.status(401).json({ error: 'Access denied. No token provided. Please log in.' });
    }

    jwt.verify(token, JWT_SECRET, (err, decodedUser) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid or expired token. Please log in again.' });
        }

        req.user = decodedUser; // Attaches user ID and email to the request
        next(); 
    });
}


// ==========================================
// USER ROUTES
// ==========================================

// SECURE Registration Route
app.post('/api/users/register', async (req, res) => {
    const { full_name, email, password } = req.body;

    try {
        const saltRounds = 10; 
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        const sqlQuery = 'INSERT INTO users (full_name, email, password) VALUES (?, ?, ?)';
        
        db.query(sqlQuery, [full_name, email, hashedPassword], (err, result) => {
            if (err) {
                console.error('Database error during registration:', err);
                return res.status(500).json({ error: 'Internal server error' });
            }
            
            res.status(201).json({
                message: 'User registered securely!',
                userId: result.insertId
            });
        });
    } catch (error) {
        console.error('Error hashing password:', error);
        res.status(500).json({ error: 'Server error during security process' });
    }
});

// SECURE Login Route (Generates and returns a JWT Token)
app.post('/api/users/login', async (req, res) => {
    const { email, password } = req.body;
    const sqlQuery = 'SELECT * FROM users WHERE email = ?';

    db.query(sqlQuery, [email], async (err, results) => {
        if (err) {
            console.error('Database error during login:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }

        if (results.length === 0) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const user = results[0];

        try {
            const match = await bcrypt.compare(password, user.password);

            if (!match) {
                return res.status(401).json({ error: 'Invalid email or password' });
            }

            const token = jwt.sign(
                { userId: user.id, email: user.email },
                JWT_SECRET,
                { expiresIn: '1h' }
            );

            res.status(200).json({
                message: 'Login successful!',
                token: token,
                userId: user.id,
                full_name: user.full_name
            });

        } catch (error) {
            console.error('Error during authentication process:', error);
            res.status(500).json({ error: 'Server error during authentication' });
        }
    });
});


// ==========================================
// VEHICLE ROUTES
// ==========================================

app.post('/api/vehicles', (req, res) => {
    const { brand, model, year, price_per_day } = req.body;
    const sqlQuery = 'INSERT INTO vehicles (brand, model, year, price_per_day) VALUES (?, ?, ?, ?)';
    
    db.query(sqlQuery, [brand, model, year, price_per_day], (err, result) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.status(201).json({ message: 'Vehicle added successfully', vehicleId: result.insertId });
    });
});

app.get('/api/vehicles', (req, res) => {
    const sqlQuery = 'SELECT * FROM vehicles';
    db.query(sqlQuery, (err, results) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.status(200).json(results);
    });
});


// ==========================================
// RENTAL ROUTES
// ==========================================

// PROTECTED ROUTE: Book a vehicle securely using the JWT token identity
app.post('/api/rentals', authenticateToken, (req, res) => {
    const { vehicle_id, rental_start_date, rental_end_date } = req.body;
    const user_id = req.user.userId; // Securely extracted from token

    const getVehicleQuery = 'SELECT price_per_day, is_available FROM vehicles WHERE id = ?';

    db.query(getVehicleQuery, [vehicle_id], (err, vehicleResults) => {
        if (err) return res.status(500).json({ error: 'Internal server error' });
        if (vehicleResults.length === 0) return res.status(404).json({ error: 'Vehicle not found' });

        const vehicle = vehicleResults[0];

        if (!vehicle.is_available) {
            return res.status(400).json({ error: 'Vehicle is currently unavailable for rent' });
        }

        const start = new Date(rental_start_date);
        const end = new Date(rental_end_date);
        const diffInDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 3600 * 24));

        if (diffInDays <= 0) return res.status(400).json({ error: 'End date must be after start date' });

        const total_cost = diffInDays * vehicle.price_per_day;
        const insertRentalQuery = 'INSERT INTO rentals (user_id, vehicle_id, rental_start_date, rental_end_date, total_cost) VALUES (?, ?, ?, ?, ?)';

        db.query(insertRentalQuery, [user_id, vehicle_id, rental_start_date, rental_end_date, total_cost], (err, rentalResult) => {
            if (err) return res.status(500).json({ error: 'Database error creating rental' });

            const updateVehicleQuery = 'UPDATE vehicles SET is_available = FALSE WHERE id = ?';
            db.query(updateVehicleQuery, [vehicle_id], (updateErr) => {
                if (updateErr) console.error('Error updating vehicle availability:', updateErr);

                res.status(201).json({
                    message: 'Vehicle booked successfully using secure token ID!',
                    rentalId: rentalResult.insertId,
                    totalDays: diffInDays,
                    totalCost: total_cost
                });
            });
        });
    });
});

// PROTECTED ROUTE: View all rentals for the currently logged-in user
app.get('/api/my-rentals', authenticateToken, (req, res) => {
    const userId = req.user.userId;

    const sqlQuery = `
        SELECT r.id AS rental_id, v.brand, v.model, r.rental_start_date, r.rental_end_date, r.total_cost, r.status 
        FROM rentals r
        JOIN vehicles v ON r.vehicle_id = v.id
        WHERE r.user_id = ?
    `;

    db.query(sqlQuery, [userId], (err, results) => {
        if (err) {
            console.error('Database error fetching user rentals:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }

        res.status(200).json({
            message: 'Rentals fetched successfully!',
            count: results.length,
            rentals: results
        });
    });
});

// Return a vehicle
app.put('/api/rentals/:id/return', (req, res) => {
    const rentalId = req.params.id;
    const getRentalQuery = 'SELECT vehicle_id, status FROM rentals WHERE id = ?';
    
    db.query(getRentalQuery, [rentalId], (err, rentalResults) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (rentalResults.length === 0) return res.status(404).json({ error: 'Rental receipt not found' });

        const rental = rentalResults[0];

        if (rental.status === 'completed') {
            return res.status(400).json({ error: 'This vehicle has already been returned' });
        }

        const updateRentalQuery = 'UPDATE rentals SET status = "completed" WHERE id = ?';
        db.query(updateRentalQuery, [rentalId], (err) => {
            if (err) return res.status(500).json({ error: 'Error updating rental status' });

            const updateVehicleQuery = 'UPDATE vehicles SET is_available = TRUE WHERE id = ?';
            db.query(updateVehicleQuery, [rental.vehicle_id], (err) => {
                if (err) return res.status(500).json({ error: 'Error updating vehicle availability' });

                res.status(200).json({ message: 'Vehicle returned successfully. It is now available for rent again!' });
            });
        });
    });
});


// Start the server
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);
});