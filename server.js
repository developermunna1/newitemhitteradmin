const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { Telegraf } = require('telegraf');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'users.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');

// --- Configuration Management ---
const loadConfig = () => {
    if (!fs.existsSync(CONFIG_FILE)) {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify({ botToken: "" }, null, 2));
    }
    return JSON.parse(fs.readFileSync(CONFIG_FILE));
};

const saveConfig = (config) => {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
};

// --- Dynamic Telegram Bot Logic ---
let bot = null;

const initBot = (token) => {
    if (!token) {
        console.warn("⚠️ No BOT_TOKEN provided. Telegram features will be disabled.");
        return null;
    }
    try {
        const newBot = new Telegraf(token);
        newBot.start((ctx) => {
            const chatId = ctx.from.id;
            ctx.reply(`✅ *Nexvora System Initialized*\n\nYour Unique ID: \`${chatId}\`\n\nPlease copy this ID and use it to log in to the Nexvora Extension.\n\n_Wait for Admin approval after entering the verification code._`, { parse_mode: 'Markdown' });
        });

        // Kill old instance if exists
        if (bot) {
            console.log("Stopping old bot instance...");
            // Polling doesn't have a simple 'stop' that is sync, but we replace the reference.
        }

        newBot.launch().then(() => {
            console.log("✅ Telegram Bot is LIVE with token:", token.substring(0, 5) + "...");
        }).catch(err => {
            console.error("❌ Bot launch error (invalid token?):", err.message);
        });

        return newBot;
    } catch (e) {
        console.error("❌ Failed to initialize bot:", e.message);
        return null;
    }
};

// Initialize on startup
const currentConfig = loadConfig();
bot = initBot(currentConfig.botToken);


// --- Express Logic ---
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

const loadDB = () => {
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify({ users: [] }, null, 2));
    }
    return JSON.parse(fs.readFileSync(DB_FILE));
};

const saveDB = (data) => {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
};

// Check user status
app.get('/api/check', (req, res) => {
    const id = req.query.id;
    if (!id) return res.status(400).json({ approved: false, error: "No ID provided" });

    const db = loadDB();
    const user = db.users.find(u => u.id === id);

    if (user) {
        if (user.banned) {
            return res.json({ approved: false, banned: true, status: 'banned', hits: user.hits || 0 });
        }
        return res.json({ approved: user.approved, banned: false, status: user.status, hits: user.hits || 0 });
    } else {
        // Auto-register new ID as pending
        const newUser = { 
            id, 
            approved: false, 
            banned: false, 
            status: 'pending', 
            hits: 0,
            firstSeen: new Date().toISOString() 
        };
        db.users.push(newUser);
        saveDB(db);
        return res.json({ approved: false, banned: false, status: 'pending', hits: 0 });
    }
});

// Relay: Send Login Code
app.post('/api/send-code', async (req, res) => {
    const { id, code } = req.body;
    if (!bot) return res.status(500).json({ success: false, error: "Bot not configured" });

    try {
        const msg = `🔐 *Nexvora Login Access*\n\nYour verification code is: \`${code}\`\n\n_If you did not request this, please ignore._`;
        await bot.telegram.sendMessage(id, msg, { parse_mode: 'Markdown' });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Relay: Notify Success Hit
app.post('/api/notify-success', async (req, res) => {
    const { id, amount, site } = req.body;
    if (!bot) return res.status(500).json({ success: false, error: "Bot not configured" });

    try {
        const msg = `🚀 *Nexvora Hit Success!*\n\n💰 *Amount:* \`${amount}\`\n🌐 *Site:* ${site}\n✨ Happy Hitting!`;
        await bot.telegram.sendMessage(id, msg, { parse_mode: 'Markdown' });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Sync hits from extension
app.post('/api/sync-hits', (req, res) => {

    const { id, hits } = req.body;
    if (!id) return res.status(400).json({ success: false, error: "No ID provided" });

    const db = loadDB();
    const userIndex = db.users.findIndex(u => u.id === id);

    if (userIndex !== -1) {
        db.users[userIndex].hits = hits;
        saveDB(db);
        res.json({ success: true });
    } else {
        res.status(404).json({ success: false, error: "User not found" });
    }
});

// Admin API: List all users
app.get('/api/admin/users', (req, res) => {
    const db = loadDB();
    res.json(db.users);
});

// Admin API: Add user manually
app.post('/api/admin/add-user', (req, res) => {
    const { id } = req.body;
    if (!id) return res.status(400).json({ success: false, error: "No ID provided" });

    const db = loadDB();
    const existing = db.users.find(u => u.id === id);

    if (existing) {
        existing.approved = true;
        existing.banned = false;
        existing.status = 'active';
    } else {
        db.users.push({
            id,
            approved: true,
            banned: false,
            status: 'active',
            hits: 0,
            firstSeen: new Date().toISOString()
        });
    }

    saveDB(db);
    res.json({ success: true });
});

// Admin API: Get Config
app.get('/api/admin/config', (req, res) => {
    const config = loadConfig();
    res.json(config);
});

// Admin API: Update Config (Bot Token)
app.post('/api/admin/config', (req, res) => {
    const { botToken } = req.body;
    if (!botToken) return res.status(400).json({ success: false, error: "No token provided" });

    const config = loadConfig();
    config.botToken = botToken;
    saveConfig(config);

    // Restart Bot
    bot = initBot(botToken);

    res.json({ success: true });
});



// Admin API: Toggle approval
app.post('/api/admin/approve', (req, res) => {
    const { id, approved } = req.body;
    const db = loadDB();
    const userIndex = db.users.findIndex(u => u.id === id);
    
    if (userIndex !== -1) {
        db.users[userIndex].approved = approved;
        db.users[userIndex].banned = false; // Unban if approved
        db.users[userIndex].status = approved ? 'active' : 'pending';
        saveDB(db);
        res.json({ success: true });
    } else {
        res.status(404).json({ success: false, error: "User not found" });
    }
});

// Admin API: Ban user
app.post('/api/admin/ban', (req, res) => {
    const { id, banned } = req.body;
    const db = loadDB();
    const userIndex = db.users.findIndex(u => u.id === id);
    
    if (userIndex !== -1) {
        db.users[userIndex].banned = banned;
        if (banned) {
            db.users[userIndex].approved = false;
            db.users[userIndex].status = 'banned';
        } else {
            db.users[userIndex].status = 'pending';
        }
        saveDB(db);
        res.json({ success: true });
    } else {
        res.status(404).json({ success: false, error: "User not found" });
    }
});

app.listen(PORT, () => {
    console.log(`Nexvora Admin Panel running on port ${PORT}`);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
