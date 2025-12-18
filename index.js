const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Storage
const servers = new Map(); // jobId -> { lastHeartbeat, placeId, players: [], messages: [] }

// Cleanup settings
const CLEANUP_THRESHOLD = 20 * 60 * 60 * 1000; // 20 hours
const CLEANUP_INTERVAL = 60 * 60 * 1000; // Check every hour

app.use(cors());
app.use(express.json());

// Request logging
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

// Health check
app.get('/', (req, res) => {
    const totalPlayers = Array.from(servers.values()).reduce((sum, s) => sum + (s.players?.length || 0), 0);
    res.json({ 
        status: 'ok', 
        activeServers: servers.size,
        totalPlayers,
        uptime: process.uptime()
    });
});

// Get all stats
app.get('/api/stats', (req, res) => {
    const stats = {
        activeServers: servers.size,
        servers: []
    };
    
    for (const [jobId, data] of servers) {
        stats.servers.push({
            jobId,
            placeId: data.placeId,
            playerCount: data.players?.length || 0,
            messageCount: data.messages.length,
            lastHeartbeat: data.lastHeartbeat,
            age: Date.now() - data.lastHeartbeat
        });
    }
    
    res.json(stats);
});

// Get servers for a place (for server browser)
app.get('/api/servers/:placeId', (req, res) => {
    const { placeId } = req.params;
    const placeServers = [];
    
    for (const [jobId, data] of servers) {
        if (data.placeId == placeId) {
            placeServers.push({
                jobId,
                placeId: data.placeId,
                playerCount: data.players?.length || 0,
                players: data.players || [],
                messageCount: data.messages.length,
                lastHeartbeat: data.lastHeartbeat
            });
        }
    }
    
    // Sort by player count (most players first)
    placeServers.sort((a, b) => b.playerCount - a.playerCount);
    
    res.json({
        placeId,
        servers: placeServers,
        count: placeServers.length
    });
});

// Heartbeat endpoint
app.post('/api/heartbeat', (req, res) => {
    const { jobId, placeId, players, playerCount } = req.body;
    
    if (!jobId) {
        return res.status(400).json({ error: 'jobId required' });
    }
    
    if (!servers.has(jobId)) {
        servers.set(jobId, {
            placeId,
            lastHeartbeat: Date.now(),
            players: players || [],
            messages: []
        });
        console.log(`[Heartbeat] New server: ${jobId} (Place: ${placeId})`);
    } else {
        const serverData = servers.get(jobId);
        serverData.lastHeartbeat = Date.now();
        serverData.players = players || serverData.players;
    }
    
    const serverData = servers.get(jobId);
    
    res.json({ 
        success: true, 
        serverCount: servers.size,
        onlineInServer: serverData.players?.length || 0
    });
});

// Post a message
app.post('/api/messages', (req, res) => {
    const { jobId, placeId, userId, username, displayName, message, timestamp, isPrivate, targetUserId } = req.body;
    
    if (!jobId || !message) {
        return res.status(400).json({ error: 'jobId and message required' });
    }
    
    // Create server entry if doesn't exist
    if (!servers.has(jobId)) {
        servers.set(jobId, {
            placeId,
            lastHeartbeat: Date.now(),
            players: [],
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
        createdAt: Date.now(),
        isPrivate: isPrivate || false,
        targetUserId: targetUserId || null
    };
    
    serverData.messages.push(messageData);
    
    // Limit messages per server
    if (serverData.messages.length > 500) {
        serverData.messages = serverData.messages.slice(-500);
    }
    
    const logPrefix = isPrivate ? '[Private]' : '[Public]';
    console.log(`${logPrefix} ${displayName || username} in ${jobId.substr(0,8)}: ${message.substr(0, 50)}`);
    
    res.json({ success: true, messageId: messageData.id });
});

// Get messages for a server
app.get('/api/messages/:jobId', (req, res) => {
    const { jobId } = req.params;
    const { since, limit = 100 } = req.query;
    
    if (!servers.has(jobId)) {
        return res.json({ messages: [], count: 0 });
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

// Get private messages for a user
app.get('/api/messages/:jobId/private/:userId', (req, res) => {
    const { jobId, userId } = req.params;
    const { since } = req.query;
    
    if (!servers.has(jobId)) {
        return res.json({ messages: [], count: 0 });
    }
    
    let messages = servers.get(jobId).messages.filter(m => 
        m.isPrivate && (m.userId == userId || m.targetUserId == userId)
    );
    
    if (since) {
        const sinceTime = parseInt(since);
        messages = messages.filter(m => m.timestamp > sinceTime);
    }
    
    res.json({
        jobId,
        userId,
        messages,
        count: messages.length
    });
});

// Get all messages for a place
app.get('/api/messages/place/:placeId', (req, res) => {
    const { placeId } = req.params;
    const allMessages = [];
    
    for (const [jobId, data] of servers) {
        if (data.placeId == placeId) {
            for (const msg of data.messages) {
                if (!msg.isPrivate) {
                    allMessages.push({ ...msg, jobId });
                }
            }
        }
    }
    
    allMessages.sort((a, b) => a.timestamp - b.timestamp);
    
    res.json({
        placeId,
        messages: allMessages.slice(-200),
        count: allMessages.length
    });
});

// Get online players for a server
app.get('/api/players/:jobId', (req, res) => {
    const { jobId } = req.params;
    
    if (!servers.has(jobId)) {
        return res.json({ players: [], count: 0 });
    }
    
    const serverData = servers.get(jobId);
    
    res.json({
        jobId,
        players: serverData.players || [],
        count: serverData.players?.length || 0
    });
});

// Get total online across all servers for a place
app.get('/api/players/place/:placeId', (req, res) => {
    const { placeId } = req.params;
    let totalPlayers = [];
    
    for (const [jobId, data] of servers) {
        if (data.placeId == placeId && data.players) {
            for (const player of data.players) {
                totalPlayers.push({ ...player, jobId });
            }
        }
    }
    
    res.json({
        placeId,
        players: totalPlayers,
        count: totalPlayers.length
    });
});

// Delete a server's data
app.delete('/api/messages/:jobId', (req, res) => {
    const { jobId } = req.params;
    
    if (servers.has(jobId)) {
        servers.delete(jobId);
        console.log(`[Cleanup] Manually deleted: ${jobId}`);
        return res.json({ success: true, deleted: true });
    }
    
    res.json({ success: true, deleted: false });
});

// Cleanup inactive servers
function cleanupInactiveServers() {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [jobId, data] of servers) {
        const age = now - data.lastHeartbeat;
        if (age > CLEANUP_THRESHOLD) {
            const hours = Math.floor(age / 3600000);
            console.log(`[Cleanup] Removing ${jobId} (inactive ${hours}h, ${data.messages.length} msgs)`);
            servers.delete(jobId);
            cleaned++;
        }
    }
    
    if (cleaned > 0) {
        console.log(`[Cleanup] Removed ${cleaned} servers. Active: ${servers.size}`);
    }
}

// Run cleanup periodically
setInterval(cleanupInactiveServers, CLEANUP_INTERVAL);

// Start server
app.listen(PORT, () => {
    console.log(`=================================`);
    console.log(`Chat API v2 running on port ${PORT}`);
    console.log(`Cleanup: ${CLEANUP_THRESHOLD / 3600000}h threshold`);
    console.log(`=================================`);
});
