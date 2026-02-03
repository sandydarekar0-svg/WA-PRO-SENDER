require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');

// Import configurations
const db = require('./config/database');

// Import routes
const authRoutes = require('./routes/auth');
const whatsappRoutes = require('./routes/whatsapp');
const templateRoutes = require('./routes/templates');
const contactRoutes = require('./routes/contacts');
const campaignRoutes = require('./routes/campaigns');
const apiRoutes = require('./routes/api');
const analyticsRoutes = require('./routes/analytics');

// Import services
const WhatsAppService = require('./services/whatsappService');
const QueueService = require('./services/queueService');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// Make io accessible to routes
app.set('io', io);

// Global WhatsApp instances storage
global.whatsappInstances = new Map();
global.io = io;

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/external', apiRoutes);
app.use('/api/analytics', analyticsRoutes);

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    
    socket.on('join-room', (userId) => {
        socket.join(`user-${userId}`);
        console.log(`User ${userId} joined room`);
    });
    
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

// Serve main HTML
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Database sync and server start
const PORT = process.env.PORT || 3000;

db.sequelize.sync({ alter: true }).then(() => {
    console.log('Database synced');
    
    server.listen(PORT, () => {
        console.log(`🚀 Server running on port ${PORT}`);
        console.log(`📱 WhatsApp Bulk Sender Ready!`);
    });
}).catch(err => {
    console.error('Database connection failed:', err);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('Shutting down...');
    for (const [userId, instance] of global.whatsappInstances) {
        await instance.logout();
    }
    process.exit(0);
});
