# Roblox External Chat System

A chat system that logs messages to an external server, with automatic cleanup for inactive game servers.

## How It Works

1. **LocalScript** sends chat messages to your Railway server via HTTP
2. **Railway server** stores messages grouped by `jobId` (unique per game server)
3. **Heartbeat system** keeps track of active servers
4. **Auto-cleanup** removes all messages from servers that haven't sent a heartbeat in 20 hours

## Railway Deployment

### Step 1: Create Railway Account
Go to [railway.app](https://railway.app) and sign up/login with GitHub.

### Step 2: Deploy the Server

**Option A: Deploy from GitHub**
1. Push the `server/` folder to a GitHub repository
2. In Railway dashboard, click "New Project" → "Deploy from GitHub repo"
3. Select your repository
4. Railway auto-detects Node.js and deploys

**Option B: Deploy with Railway CLI**
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Navigate to server folder
cd server

# Initialize and deploy
railway init
railway up
```

### Step 3: Get Your URL
After deployment, Railway gives you a URL like:
```
https://your-app-name.up.railway.app
```

### Step 4: Configure Roblox

1. In Roblox Studio, go to Game Settings → Security
2. Enable "Allow HTTP Requests"
3. In the LocalScript, update the `SERVER_URL`:
```lua
local CONFIG = {
    SERVER_URL = "https://your-app-name.up.railway.app", -- Your Railway URL
    ...
}
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Health check, shows active server count |
| GET | `/api/stats` | Detailed stats for all servers |
| POST | `/api/heartbeat` | Keep server alive (sent automatically) |
| POST | `/api/messages` | Send a new message |
| GET | `/api/messages/:jobId` | Get messages for a game server |
| GET | `/api/messages/place/:placeId` | Get all messages for a place |
| DELETE | `/api/messages/:jobId` | Manually delete server data |

## Message Format

```json
{
    "jobId": "abc-123-def",
    "placeId": 123456789,
    "userId": 12345,
    "username": "Player1",
    "displayName": "Cool Player",
    "message": "Hello world!",
    "timestamp": 1699999999
}
```

## Cleanup Behavior

- Servers send heartbeat every 5 minutes (configurable)
- Server checks for inactive servers every hour
- Servers inactive for 20+ hours are automatically deleted with all their messages
- This handles game servers that shut down without explicit cleanup

## Configuration

### LocalScript (`ChatLocalScript.lua`)
```lua
local CONFIG = {
    SERVER_URL = "https://your-app.railway.app",
    HEARTBEAT_INTERVAL = 300,  -- 5 minutes
    MAX_MESSAGES = 100,        -- UI message limit
    CHAT_HISTORY_ON_JOIN = true
}
```

### Server (`index.js`)
```javascript
const CLEANUP_THRESHOLD = 20 * 60 * 60 * 1000; // 20 hours
const CLEANUP_INTERVAL = 60 * 60 * 1000;       // Check every hour
```

## Production Recommendations

For production use, consider:

1. **Add Redis** for persistent storage (Railway has Redis add-on)
2. **Add authentication** to prevent abuse
3. **Rate limiting** to prevent spam
4. **Message validation/filtering** for inappropriate content

## File Structure

```
roblox-chat/
├── ChatLocalScript.lua    # Put in StarterPlayerScripts
└── server/
    ├── index.js           # Main server code
    ├── package.json       # Dependencies
    └── railway.toml       # Railway config
```
