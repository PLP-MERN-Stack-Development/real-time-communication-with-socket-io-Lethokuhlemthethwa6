const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const multer = require('multer');
const fs = require('fs');

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Serve uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Simple in-memory fallback stores (still use DB)
const typingUsers = {};

const JWT_SECRET = process.env.JWT_SECRET || 'secret_demo_key';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/socketio_chat_demo';

// DB models
const User = require('./models/User');
const Message = require('./models/Message');

// Connect to MongoDB
mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('Connected to MongoDB'))
  .catch((err) => console.error('MongoDB connection error', err));

// Setup multer for file uploads to /uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `${unique}${ext}`);
  }
});
const upload = multer({ storage });

// Auth route - Issue JWT for a username (simple)
app.post('/api/login', async (req, res) => {
  const { username } = req.body;
  if (!username || typeof username !== 'string' || username.trim().length < 1) {
    return res.status(400).json({ error: 'Invalid username' });
  }
  const payload = { username: username.trim() };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
  return res.json({ token, username: payload.username });
});

// File upload endpoint
app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const file = req.file;
  const url = `${req.protocol}://${req.get('host')}/uploads/${file.filename}`;
  return res.json({ filename: file.filename, url, mimetype: file.mimetype, size: file.size });
});

// API routes
app.get('/api/messages', async (req, res) => {
  const msgs = await Message.find().sort({ timestamp: 1 }).limit(500).lean();
  res.json(msgs);
});

app.get('/api/users', async (req, res) => {
  const users = await User.find().lean();
  res.json(users);
});

// Socket.io connection handler with auth
io.on('connection', (socket) => {
  // Try to authenticate from socket handshake
  const token = socket.handshake.auth && socket.handshake.auth.token;
  let usernameFromToken = null;
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      usernameFromToken = decoded.username;
      // create or update user in DB
      User.findOneAndUpdate({ username: usernameFromToken }, { socketId: socket.id }, { upsert: true, new: true }).exec()
        .then(() => User.find().lean().then(users => io.emit('user_list', users)));
      io.emit('user_joined', { username: usernameFromToken, id: socket.id });
      console.log(`Authenticated user connected: ${usernameFromToken} (${socket.id})`);
    } catch (err) {
      console.log('Invalid token for socket connection', err.message);
    }
  } else {
    console.log(`User connected (unauthenticated): ${socket.id}`);
  }

  // Handle user_join fallback (client may emit username)
  socket.on('user_join', async (username) => {
    await User.findOneAndUpdate({ username }, { socketId: socket.id }, { upsert: true, new: true }).exec();
    const users = await User.find().lean();
    io.emit('user_list', users);
    io.emit('user_joined', { username, id: socket.id });
    console.log(`${username} joined the chat`);
  });

  // Handle chat messages (public and private)
  socket.on('send_message', async (messageData, ack) => {
    const sender = (await User.findOne({ socketId: socket.id }).lean())?.username || usernameFromToken || 'Anonymous';
    const messageDoc = new Message({
      sender,
      senderId: socket.id,
      message: messageData.message || '',
      isPrivate: !!messageData.isPrivate,
      to: messageData.to || null,
      file: messageData.file || null,
      deliveredTo: [],
      readBy: [],
    });
    await messageDoc.save();

    const msg = messageDoc.toObject();

    if (msg.isPrivate && msg.to) {
      socket.to(msg.to).emit('private_message', msg);
      socket.emit('private_message', msg);
    } else {
      io.emit('receive_message', msg);
    }

    // Immediately acknowledge sender that server received and stored message
    if (ack && typeof ack === 'function') {
      ack({ status: 'stored', id: msg._id });
    }

    // Emit delivered event to sender (server-side immediate delivered)
    socket.emit('message_delivered', { id: msg._id, to: msg.to || 'all' });
  });

  // When a client notifies that they have received/delivered a message
  socket.on('message_delivered', async ({ id }) => {
    // mark delivered
    await Message.findByIdAndUpdate(id, { $addToSet: { deliveredTo: socket.id } }).exec();
    // inform sender
    const msg = await Message.findById(id).lean();
    if (msg) {
      io.to(msg.senderId).emit('message_delivered', { id: msg._id, by: socket.id });
    }
  });

  // Read receipts
  socket.on('message_read', async ({ id }) => {
    await Message.findByIdAndUpdate(id, { $addToSet: { readBy: socket.id } }).exec();
    const msg = await Message.findById(id).lean();
    if (msg) {
      io.to(msg.senderId).emit('message_read', { id: msg._id, by: socket.id });
    }
  });

  // Handle typing indicator
  socket.on('typing', (isTyping) => {
    User.findOne({ socketId: socket.id }).lean().then(user => {
      if (!user) return;
      if (isTyping) typingUsers[socket.id] = user.username;
      else delete typingUsers[socket.id];
      io.emit('typing_users', Object.values(typingUsers));
    });
  });

  // Handle private messages (legacy)
  socket.on('private_message', async ({ to, message }) => {
    const sender = (await User.findOne({ socketId: socket.id }).lean())?.username || usernameFromToken || 'Anonymous';
    const messageDoc = new Message({
      sender,
      senderId: socket.id,
      message,
      isPrivate: true,
      to,
      deliveredTo: [],
      readBy: [],
    });
    await messageDoc.save();
    const msg = messageDoc.toObject();
    socket.to(to).emit('private_message', msg);
    socket.emit('private_message', msg);
    socket.emit('message_delivered', { id: msg._id, to });
  });

  // Handle disconnection
  socket.on('disconnect', async () => {
    // clear socketId for user
    await User.findOneAndUpdate({ socketId: socket.id }, { $unset: { socketId: "" } }).exec();
    delete typingUsers[socket.id];
    const users = await User.find().lean();
    io.emit('user_list', users);
    io.emit('typing_users', Object.values(typingUsers));
    console.log('Socket disconnected', socket.id);
  });
});

// Root route
app.get('/', (req, res) => {
  res.send('Socket.io Chat Server is running');
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = { app, server, io };

// --- Delete all messages permanently ---
app.delete('/api/messages/all', async (req, res) => {
  try {
    await Message.deleteMany({});
    // Broadcast to all clients so they can clear messages
    io.emit('messages_cleared');
    res.json({ success: true, message: 'All messages deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// --- Delete all users permanently (optional) ---
app.delete('/api/users/all', async (req, res) => {
  try {
    await User.deleteMany({});
    io.emit('users_cleared');
    res.json({ success: true, message: 'All users deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});
// --- Clear all data (messages and users) permanently ---
app.delete('/api/clear_all', async (req, res) => {
  try {
    await Message.deleteMany({});
    await User.deleteMany({});
    io.emit('data_cleared');
    res.json({ success: true, message: 'All messages and users deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// --- Delete specific message by ID ---
app.delete('/api/messages/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await Message.findByIdAndDelete(id);
    if (!result) return res.status(404).json({ success: false, message: 'Message not found' });
    io.emit('message_deleted', { id });
    res.json({ success: true, message: 'Message deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// --- Delete specific user by ID ---
app.delete('/api/users/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await User.findByIdAndDelete(id);
    if (!result) return res.status(404).json({ success: false, message: 'User not found' });
    io.emit('user_deleted', { id });
    res.json({ success: true, message: 'User deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});