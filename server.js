const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const { v4: uuidv4 } = require('uuid');
const RateLimiter = require('rate-limiter-flexible');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Rate limiting
const rateLimiter = new RateLimiter.RateLimiterMemory({
  keyGenerator: (req) => req.ip,
  points: 100, // Number of requests
  duration: 60, // Per 60 seconds
});

// Store active users and rooms
const activeUsers = new Map();
const chatRooms = new Map();
const videoRooms = new Map();
const waitingUsers = new Map();

// Track previous connections to avoid repeat matches
const previousConnections = new Map(); // userId -> Set of previous partner IDs
const userConnectionCount = new Map(); // userId -> number of connections made
const userLastConnectionTime = new Map(); // userId -> timestamp of last connection

// Helper functions
function generateRoomId() {
  return uuidv4().substring(0, 8);
}

function getRandomUserFromWaiting(type, currentUserId) {
  const waiting = Array.from(waitingUsers.values()).filter(user => user.type === type);
  
  if (waiting.length === 0) return null;
  
  // Get user's previous connections and connection count
  const userPreviousConnections = previousConnections.get(currentUserId) || new Set();
  const currentUserConnectionCount = userConnectionCount.get(currentUserId) || 0;
  
  // Filter out self
  const availablePartners = waiting.filter(user => user.id !== currentUserId);
  
  if (availablePartners.length === 0) return null;
  
  // Create weighted scoring system for fair distribution
  const scoredPartners = availablePartners.map(user => {
    const partnerConnectionCount = userConnectionCount.get(user.id) || 0;
    const hasConnectedBefore = userPreviousConnections.has(user.id);
    
    // Base score (lower connection count = higher priority)
    let score = partnerConnectionCount;
    
    // Bonus for new connections (but not required)
    if (!hasConnectedBefore) {
      score -= 2; // Give slight preference to new connections
    }
    
    // Add some randomness to keep it interesting
    score += Math.random() * 0.5;
    
    return { user, score };
  });
  
  // Sort by score (lower score = higher priority)
  scoredPartners.sort((a, b) => a.score - b.score);
  
  console.log(`Matching user ${currentUserId} with partner ${scoredPartners[0].user.id} (score: ${scoredPartners[0].score.toFixed(2)})`);
  
  return scoredPartners[0].user;
}

function removeUserFromWaiting(userId) {
  waitingUsers.delete(userId);
}

function trackConnection(userId, partnerId) {
  // Check if this is a repeat connection
  const hasConnectedBefore = previousConnections.has(userId) && 
                            previousConnections.get(userId).has(partnerId);
  
  // Track previous connections
  if (!previousConnections.has(userId)) {
    previousConnections.set(userId, new Set());
  }
  previousConnections.get(userId).add(partnerId);
  
  // Update connection count
  const currentCount = userConnectionCount.get(userId) || 0;
  userConnectionCount.set(userId, currentCount + 1);
  
  // Update last connection time
  userLastConnectionTime.set(userId, Date.now());
  
  if (hasConnectedBefore) {
    console.log(`Reconnecting: ${userId} -> ${partnerId} (total connections: ${currentCount + 1})`);
  } else {
    console.log(`New connection: ${userId} -> ${partnerId} (total connections: ${currentCount + 1})`);
  }
  
  return hasConnectedBefore;
}

function createRoom(user1, user2, type) {
  const roomId = generateRoomId();
  const room = {
    id: roomId,
    type: type, // 'chat' or 'video'
    users: [user1, user2],
    messages: [],
    createdAt: Date.now()
  };

  if (type === 'chat') {
    chatRooms.set(roomId, room);
  } else {
    videoRooms.set(roomId, room);
  }

  return room;
}

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // User joins with their preferences
  socket.on('join', (data) => {
    const { userId, type, preferences } = data;
    
    // Store user info
    activeUsers.set(socket.id, {
      id: userId,
      socketId: socket.id,
      type: type,
      preferences: preferences || {},
      connectedAt: Date.now()
    });

    // Add to waiting list
    waitingUsers.set(userId, {
      id: userId,
      socketId: socket.id,
      type: type,
      preferences: preferences || {}
    });

    // Try to find a partner
    const partner = getRandomUserFromWaiting(type, userId);
    
    if (partner && partner.id !== userId) {
      // Remove both users from waiting
      removeUserFromWaiting(userId);
      removeUserFromWaiting(partner.id);

      // Track the connection
      const isRepeatConnection = trackConnection(userId, partner.id);
      trackConnection(partner.id, userId);

      // Create room
      const room = createRoom(userId, partner.id, type);
      
      // Join both users to the room
      socket.join(room.id);
      io.sockets.sockets.get(partner.socketId)?.join(room.id);

      // Notify both users
      io.to(room.id).emit('partner_found', {
        roomId: room.id,
        partnerId: type === 'chat' ? partner.id : null, // Don't expose partner ID in video calls for privacy
        isRepeatConnection: isRepeatConnection
      });

      console.log(`Created ${type} room ${room.id} for users ${userId} and ${partner.id}`);
    } else {
      // No partner found, stay in waiting
      socket.emit('waiting_for_partner');
    }

    // Update user count
    const userCount = activeUsers.size;
    io.emit('user_count_update', { count: userCount });
  });

  // Chat message handling
  socket.on('send_message', (data) => {
    const { roomId, message } = data;
    const room = chatRooms.get(roomId);
    
    if (room) {
      const messageObj = {
        id: uuidv4(),
        text: message,
        sender: activeUsers.get(socket.id)?.id || 'unknown',
        timestamp: new Date(),
        type: 'message'
      };

      room.messages.push(messageObj);
      // Send to other users in the room (not the sender)
      socket.to(roomId).emit('new_message', messageObj);
    }
  });

  // Typing indicator
  socket.on('typing', (data) => {
    const { roomId, isTyping } = data;
    socket.to(roomId).emit('user_typing', { isTyping });
  });

  // WebRTC signaling for video calls
  socket.on('offer', (data) => {
    const { roomId, offer } = data;
    socket.to(roomId).emit('offer', { offer });
  });

  socket.on('answer', (data) => {
    const { roomId, answer } = data;
    socket.to(roomId).emit('answer', { answer });
  });

  socket.on('ice_candidate', (data) => {
    const { roomId, candidate } = data;
    socket.to(roomId).emit('ice_candidate', { candidate });
  });

  // User disconnection
  socket.on('disconnect', () => {
    const user = activeUsers.get(socket.id);
    if (user) {
      // Remove from active users
      activeUsers.delete(socket.id);
      removeUserFromWaiting(user.id);

      // Find and clean up rooms
      const userRooms = [];
      
      // Check chat rooms
      for (const [roomId, room] of chatRooms.entries()) {
        if (room.users.includes(user.id)) {
          userRooms.push({ roomId, type: 'chat' });
        }
      }

      // Check video rooms
      for (const [roomId, room] of videoRooms.entries()) {
        if (room.users.includes(user.id)) {
          userRooms.push({ roomId, type: 'video' });
        }
      }

      // Notify partner and clean up rooms
      userRooms.forEach(({ roomId, type }) => {
        io.to(roomId).emit('partner_disconnected');
        
        if (type === 'chat') {
          chatRooms.delete(roomId);
        } else {
          videoRooms.delete(roomId);
        }
      });

      // Update user count
      const userCount = activeUsers.size;
      io.emit('user_count_update', { count: userCount });

      console.log(`User disconnected: ${user.id}`);
    }
  });

  // Leave room
  socket.on('leave_room', (data) => {
    const { roomId } = data;
    const user = activeUsers.get(socket.id);
    
    if (user) {
      socket.leave(roomId);
      socket.to(roomId).emit('partner_disconnected');
      
      // Clean up room
      chatRooms.delete(roomId);
      videoRooms.delete(roomId);
    }
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    activeUsers: activeUsers.size,
    chatRooms: chatRooms.size,
    videoRooms: videoRooms.size,
    waitingUsers: waitingUsers.size
  });
});

// Stats endpoint with connection tracking info
app.get('/stats', (req, res) => {
  const totalConnections = Array.from(userConnectionCount.values()).reduce((sum, count) => sum + count, 0);
  const avgConnectionsPerUser = userConnectionCount.size > 0 ? totalConnections / userConnectionCount.size : 0;
  
  // Calculate engagement metrics
  const mostActiveUser = Array.from(userConnectionCount.entries())
    .sort(([,a], [,b]) => b - a)[0];
  
  const recentConnections = Array.from(userLastConnectionTime.entries())
    .filter(([, time]) => time > Date.now() - (60 * 60 * 1000)) // Last hour
    .length;
  
  res.json({
    activeUsers: activeUsers.size,
    chatRooms: chatRooms.size,
    videoRooms: videoRooms.size,
    waitingUsers: waitingUsers.size,
    totalConnections,
    avgConnectionsPerUser: Math.round(avgConnectionsPerUser * 100) / 100,
    usersWithConnections: userConnectionCount.size,
    mostActiveUser: mostActiveUser ? { userId: mostActiveUser[0], connections: mostActiveUser[1] } : null,
    recentConnections,
    uptime: process.uptime(),
    engagement: {
      totalConnections,
      avgConnectionsPerUser: Math.round(avgConnectionsPerUser * 100) / 100,
      recentConnections,
      activeUsers: activeUsers.size
    }
  });
});

// Clean up old connection data (run every hour)
setInterval(() => {
  const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
  let cleanedCount = 0;
  
  for (const [userId, lastTime] of userLastConnectionTime.entries()) {
    if (lastTime < oneDayAgo) {
      previousConnections.delete(userId);
      userConnectionCount.delete(userId);
      userLastConnectionTime.delete(userId);
      cleanedCount++;
    }
  }
  
  if (cleanedCount > 0) {
    console.log(`Cleaned up connection data for ${cleanedCount} inactive users`);
  }
}, 60 * 60 * 1000); // Run every hour



const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Stats: http://localhost:${PORT}/stats`);
}); 