const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'users.json');

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Load database
const loadDB = () => {
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify({ users: [] }, null, 2));
    }
    return JSON.parse(fs.readFileSync(DB_FILE));
};

// Save database
const saveDB = (data) => {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
};

// --- API Endpoints ---

// Check user status
app.get('/api/check', (req, res) => {
    const id = req.query.id;
    if (!id) return res.status(400).json({ approved: false, error: "No ID provided" });

    const db = loadDB();
    const user = db.users.find(u => u.id === id);

    if (user) {
        return res.json({ approved: user.approved, status: user.status });
    } else {
        // Auto-register new ID as pending
        db.users.push({ id, approved: false, status: 'pending', firstSeen: new Date().toISOString() });
        saveDB(db);
        return res.json({ approved: false, status: 'pending' });
    }
});

// Admin API: List all users
app.get('/api/admin/users', (req, res) => {
    const db = loadDB();
    res.json(db.users);
});

// Admin API: Toggle approval
app.post('/api/admin/approve', (req, res) => {
    const { id, approved } = req.body;
    const db = loadDB();
    const userIndex = db.users.findIndex(u => u.id === id);
    
    if (userIndex !== -1) {
        db.users[userIndex].approved = approved;
        db.users[userIndex].status = approved ? 'active' : 'pending';
        saveDB(db);
        res.json({ success: true });
    } else {
        res.status(404).json({ success: false, error: "User not found" });
    }
});

app.listen(PORT, () => {
    console.log(`Nexvora Admin Panel running on port ${PORT}`);
});
