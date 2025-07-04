# Random Chat & Video Call Backend

A Node.js backend server for anonymous chat and video call functionality using Socket.io and WebRTC signaling.

## Features

- **Real-time Chat**: Anonymous text messaging with random user pairing
- **Video Calls**: WebRTC-based video calls with signaling server
- **User Matching**: Automatic pairing of users for both chat and video calls
- **Room Management**: Dynamic room creation and cleanup
- **Connection Management**: Robust connection handling and error recovery
- **Rate Limiting**: Protection against abuse
- **Health Monitoring**: Built-in health checks and statistics

## Prerequisites

- Node.js 16+ 
- npm or yarn
- (Optional) Redis for production scaling

## Installation

1. **Clone and install dependencies:**
   ```bash
   cd backend
   npm install
   ```

2. **Set up environment variables:**
   ```bash
   cp env.example .env
   # Edit .env with your configuration
   ```

3. **Start the server:**
   ```bash
   # Development
   npm run dev
   
   # Production
   npm start
   ```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 3000 |
| `NODE_ENV` | Environment mode | development |
| `CORS_ORIGIN` | CORS allowed origins | * |
| `RATE_LIMIT_POINTS` | Rate limit requests | 100 |
| `RATE_LIMIT_DURATION` | Rate limit window (seconds) | 60 |

### WebRTC Configuration

For production video calls, you'll need STUN/TURN servers:

```env
STUN_SERVER_1=stun:stun.l.google.com:19302
STUN_SERVER_2=stun:stun1.l.google.com:19302
TURN_SERVER=your-turn-server.com:3478
TURN_USERNAME=your-username
TURN_CREDENTIAL=your-password
```

## API Endpoints

### Health Check
```
GET /health
```
Returns server status and current statistics.

### Statistics
```
GET /stats
```
Returns detailed server statistics.

## Socket.io Events

### Client to Server

#### Join Queue
```javascript
socket.emit('join', {
  userId: 'user-id',
  type: 'chat' | 'video',
  preferences: {}
});
```

#### Send Message (Chat)
```javascript
socket.emit('send_message', {
  roomId: 'room-id',
  message: 'Hello!'
});
```

#### Typing Indicator (Chat)
```javascript
socket.emit('typing', {
  roomId: 'room-id',
  isTyping: true
});
```

#### WebRTC Signaling (Video)
```javascript
// Send offer
socket.emit('offer', {
  roomId: 'room-id',
  offer: RTCSessionDescription
});

// Send answer
socket.emit('answer', {
  roomId: 'room-id',
  answer: RTCSessionDescription
});

// Send ICE candidate
socket.emit('ice_candidate', {
  roomId: 'room-id',
  candidate: RTCIceCandidate
});
```

#### Leave Room
```javascript
socket.emit('leave_room', {
  roomId: 'room-id'
});
```

### Server to Client

#### Connection Status
```javascript
socket.on('waiting_for_partner', () => {});
socket.on('partner_found', (data) => {
  // data.roomId, data.partnerId (chat only)
});
socket.on('partner_disconnected', () => {});
```

#### Chat Events
```javascript
socket.on('new_message', (message) => {
  // message: { id, text, sender, timestamp, type }
});
socket.on('user_typing', (data) => {
  // data.isTyping
});
```

#### Video Call Events
```javascript
socket.on('offer', (data) => {
  // data.offer: RTCSessionDescription
});
socket.on('answer', (data) => {
  // data.answer: RTCSessionDescription
});
socket.on('ice_candidate', (data) => {
  // data.candidate: RTCIceCandidate
});
```

#### General Events
```javascript
socket.on('user_count_update', (data) => {
  // data.count: number of active users
});
```

## Architecture

### User Flow

1. **Connection**: User connects via Socket.io
2. **Join Queue**: User joins waiting queue for chat/video
3. **Matching**: Server pairs users randomly
4. **Room Creation**: Server creates room and joins both users
5. **Communication**: Users communicate through room
6. **Cleanup**: Server cleans up when users disconnect

### Data Structures

#### User
```javascript
{
  id: string,
  socketId: string,
  type: 'chat' | 'video',
  preferences: object,
  connectedAt: timestamp
}
```

#### Room
```javascript
{
  id: string,
  type: 'chat' | 'video',
  users: [userId1, userId2],
  messages: [], // chat only
  createdAt: timestamp
}
```

## Production Deployment

### 1. Environment Setup
```bash
NODE_ENV=production
PORT=3000
CORS_ORIGIN=https://yourdomain.com
```

### 2. Process Management
Use PM2 for production:
```bash
npm install -g pm2
pm2 start server.js --name "random-chat-backend"
pm2 startup
pm2 save
```

### 3. Reverse Proxy
Set up Nginx as reverse proxy:
```nginx
server {
    listen 80;
    server_name yourdomain.com;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 4. SSL/HTTPS
Use Let's Encrypt for free SSL certificates.

### 5. Monitoring
- Set up logging with Winston
- Monitor with PM2 or similar
- Set up alerts for server health

## Security Considerations

1. **Rate Limiting**: Implemented to prevent abuse
2. **Input Validation**: Validate all user inputs
3. **CORS**: Configure appropriate origins
4. **Helmet**: Security headers middleware
5. **Environment Variables**: Keep secrets secure

## Scaling

### Horizontal Scaling
For multiple server instances:
1. Use Redis adapter for Socket.io
2. Implement sticky sessions
3. Use load balancer

### Redis Setup
```bash
npm install socket.io-redis redis
```

```javascript
const redis = require('socket.io-redis');
io.adapter(redis({ host: 'localhost', port: 6379 }));
```

## Troubleshooting

### Common Issues

1. **Connection Refused**: Check if server is running and port is correct
2. **CORS Errors**: Verify CORS_ORIGIN configuration
3. **WebRTC Issues**: Check STUN/TURN server configuration
4. **Memory Leaks**: Monitor room cleanup and user disconnection

### Logs
Check server logs for detailed error information:
```bash
pm2 logs random-chat-backend
```

## Development

### Running Tests
```bash
npm test
```

### Code Style
Use ESLint and Prettier for consistent code style.

### Contributing
1. Fork the repository
2. Create feature branch
3. Make changes
4. Add tests
5. Submit pull request

## License

MIT License - see LICENSE file for details. 