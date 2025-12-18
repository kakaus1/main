const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// In-memory storage (use Redis/database for production)
const servers = new Map(); // jobId -> { lastHeartbeat, placeId, messages: [] }

// Cleanup interval - 20 hours in milliseconds
const CLEANUP_THRESHOLD = 20 * 60 * 60 * 1000;
const CLEANUP_INTERVAL = 60 * 60 * 1000; // Check every hour

app.use(cors());
app.use(express.json());

// Middleware to log requests
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

// Health check
app.get('/', (req, res) => {
    res.json({ 
        status: 'ok', 
        activeServers: servers.size,
        uptime: process.uptime()
    });
});

// Get server stats
app.get('/api/stats', (req, res) => {
    const stats = {
        activeServers: servers.size,
        servers: []
    };
    
    for (const [jobId, data] of servers) {
        stats.servers.push({
            jobId,
            placeId: data.placeId,
            messageCount: data.messages.length,
            lastHeartbeat: data.lastHeartbeat,
            age: Date.now() - data.lastHeartbeat
        });
    }
    
    res.json(stats);
});

// Heartbeat endpoint - servers call this to stay alive
app.post('/api/heartbeat', (req, res) => {
    const { jobId, placeId } = req.body;
    
    if (!jobId) {
        return res.status(400).json({ error: 'jobId required' });
    }
    
    if (!servers.has(jobId)) {
        servers.set(jobId, {
            placeId,
            lastHeartbeat: Date.now(),
            messages: []
        });
        console.log(`[Heartbeat] New server registered: ${jobId}`);
    } else {
        servers.get(jobId).lastHeartbeat = Date.now();
    }
    
    res.json({ success: true, serverCount: servers.size });
});

// Post a message
app.post('/api/messages', (req, res) => {
    const { jobId, placeId, userId, username, displayName, message, timestamp } = req.body;
    
    if (!jobId || !message) {
        return res.status(400).json({ error: 'jobId and message required' });
    }
    
    // Create server entry if doesn't exist
    if (!servers.has(jobId)) {
        servers.set(jobId, {
            placeId,
            lastHeartbeat: Date.now(),
            messages: []
        });
    }
    
    const serverData = servers.get(jobId);
    serverData.lastHeartbeat = Date.now();
    
    const messageData = {
        id: `${jobId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        userId,
        username,
        displayName,
        message,
        timestamp: timestamp || Math.floor(Date.now() / 1000),
        createdAt: Date.now()
    };
    
    serverData.messages.push(messageData);
    
    // Limit messages per server (keep last 500)
    if (serverData.messages.length > 500) {
        serverData.messages = serverData.messages.slice(-500);
    }
    
    console.log(`[Message] ${displayName || username} in ${jobId}: ${message}`);
    
    res.json({ success: true, messageId: messageData.id });
});

// Get messages for a server
app.get('/api/messages/:jobId', (req, res) => {
    const { jobId } = req.params;
    const { since, limit = 100 } = req.query;
    
    if (!servers.has(jobId)) {
        return res.json({ messages: [] });
    }
    
    let messages = servers.get(jobId).messages;
    
    // Filter by timestamp if 'since' provided
    if (since) {
        const sinceTime = parseInt(since);
        messages = messages.filter(m => m.timestamp > sinceTime);
    }
    
    // Limit results
    messages = messages.slice(-parseInt(limit));
    
    res.json({ 
        jobId,
        messages,
        count: messages.length
    });
});

// Get all messages across all servers (for a place)
app.get('/api/messages/place/:placeId', (req, res) => {
    const { placeId } = req.params;
    const allMessages = [];
    
    for (const [jobId, data] of servers) {
        if (data.placeId == placeId) {
            for (const msg of data.messages) {
                allMessages.push({ ...msg, jobId });
            }
        }
    }
    
    // Sort by timestamp
    allMessages.sort((a, b) => a.timestamp - b.timestamp);
    
    res.json({
        placeId,
        messages: allMessages.slice(-200),
        count: allMessages.length
    });
});

// Delete messages for a server (manual cleanup)
app.delete('/api/messages/:jobId', (req, res) => {
    const { jobId } = req.params;
    
    if (servers.has(jobId)) {
        servers.delete(jobId);
        console.log(`[Cleanup] Manually deleted server: ${jobId}`);
        return res.json({ success: true, deleted: true });
    }
    
    res.json({ success: true, deleted: false });
});

// Cleanup function - removes servers that haven't sent heartbeat in 20 hours
function cleanupInactiveServers() {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [jobId, data] of servers) {
        const age = now - data.lastHeartbeat;
        if (age > CLEANUP_THRESHOLD) {
            console.log(`[Cleanup] Removing inactive server ${jobId} (age: ${Math.floor(age / 3600000)}h)`);
            servers.delete(jobId);
            cleaned++;
        }
    }
    
    if (cleaned > 0) {
        console.log(`[Cleanup] Removed ${cleaned} inactive servers. Active: ${servers.size}`);
    }
}

// Run cleanup periodically
setInterval(cleanupInactiveServers, CLEANUP_INTERVAL);

// Start server
app.listen(PORT, () => {
    console.log(`Chat API server running on port ${PORT}`);
    console.log(`Cleanup threshold: ${CLEANUP_THRESHOLD / 3600000} hours`);
});
