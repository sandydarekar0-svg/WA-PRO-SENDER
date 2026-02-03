const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const WhatsAppService = require('../services/whatsappService');
const db = require('../config/database');

// Initialize WhatsApp connection
router.post('/connect', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        
        let instance = global.whatsappInstances.get(userId);
        
        if (!instance) {
            instance = new WhatsAppService(userId);
            await instance.initialize();
            global.whatsappInstances.set(userId, instance);
        }

        const status = await instance.getStatus();
        res.json({ success: true, status });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get connection status
router.get('/status', authMiddleware, async (req, res) => {
    try {
        const instance = global.whatsappInstances.get(req.user.id);
        
        if (!instance) {
            return res.json({
                success: true,
                status: {
                    connected: false,
                    phone: null,
                    qrCode: null
                }
            });
        }

        const status = await instance.getStatus();
        res.json({ success: true, status });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Disconnect WhatsApp
router.post('/disconnect', authMiddleware, async (req, res) => {
    try {
        const instance = global.whatsappInstances.get(req.user.id);
        
        if (instance) {
            await instance.logout();
        }

        await db.User.update(
            { whatsappConnected: false, whatsappNumber: null },
            { where: { id: req.user.id } }
        );

        res.json({ success: true, message: 'Disconnected successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Send single message
router.post('/send', authMiddleware, async (req, res) => {
    try {
        const { phone, message, mediaType, mediaUrl, buttons, footer } = req.body;
        
        const instance = global.whatsappInstances.get(req.user.id);
        if (!instance || !instance.isConnected) {
            return res.status(400).json({ error: 'WhatsApp not connected' });
        }

        // Check daily limit
        if (req.user.messagesUsedToday >= req.user.dailyLimit) {
            return res.status(400).json({ error: 'Daily message limit reached' });
        }

        const result = await instance.sendMessage(phone, message, {
            mediaType,
            mediaUrl,
            buttons,
            footer
        });

        // Save message
        await db.Message.create({
            userId: req.user.id,
            phone,
            message,
            mediaType,
            mediaUrl,
            status: 'sent',
            whatsappMessageId: result.messageId,
            sentAt: new Date(),
            source: 'manual'
        });

        // Update usage
        await req.user.update({
            messagesUsedToday: req.user.messagesUsedToday + 1,
            messagesUsedMonth: req.user.messagesUsedMonth + 1
        });

        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Send bulk messages
router.post('/send-bulk', authMiddleware, async (req, res) => {
    try {
        const { messages, settings } = req.body;
        
        const instance = global.whatsappInstances.get(req.user.id);
        if (!instance || !instance.isConnected) {
            return res.status(400).json({ error: 'WhatsApp not connected' });
        }

        // Check limit
        const remainingMessages = req.user.dailyLimit - req.user.messagesUsedToday;
        if (messages.length > remainingMessages) {
            return res.status(400).json({ 
                error: `Can only send ${remainingMessages} more messages today` 
            });
        }

        // Start sending in background
        res.json({ 
            success: true, 
            message: 'Bulk sending started',
            totalMessages: messages.length
        });

        // Process messages
        const results = await instance.sendBulkMessages(messages, settings);
        
        // Save messages
        for (const result of results) {
            await db.Message.create({
                userId: req.user.id,
                phone: result.phone,
                message: messages.find(m => m.phone === result.phone)?.message,
                status: result.success ? 'sent' : 'failed',
                whatsappMessageId: result.messageId,
                errorMessage: result.error,
                sentAt: result.success ? new Date() : null,
                source: 'manual'
            });
        }

        // Update usage
        const successCount = results.filter(r => r.success).length;
        await req.user.update({
            messagesUsedToday: req.user.messagesUsedToday + successCount,
            messagesUsedMonth: req.user.messagesUsedMonth + successCount
        });

    } catch (error) {
        console.error('Bulk send error:', error);
    }
});

// Check if number exists on WhatsApp
router.post('/check-number', authMiddleware, async (req, res) => {
    try {
        const { phone } = req.body;
        
        const instance = global.whatsappInstances.get(req.user.id);
        if (!instance || !instance.isConnected) {
            return res.status(400).json({ error: 'WhatsApp not connected' });
        }

        const exists = await instance.checkNumber(phone);
        res.json({ success: true, exists });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Validate multiple numbers
router.post('/validate-numbers', authMiddleware, async (req, res) => {
    try {
        const { phones } = req.body;
        
        const instance = global.whatsappInstances.get(req.user.id);
        if (!instance || !instance.isConnected) {
            return res.status(400).json({ error: 'WhatsApp not connected' });
        }

        const results = [];
        for (const phone of phones) {
            const exists = await instance.checkNumber(phone);
            results.push({ phone, valid: exists });
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        res.json({ success: true, results });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get profile picture
router.get('/profile-picture/:phone', authMiddleware, async (req, res) => {
    try {
        const instance = global.whatsappInstances.get(req.user.id);
        if (!instance || !instance.isConnected) {
            return res.status(400).json({ error: 'WhatsApp not connected' });
        }

        const url = await instance.getProfilePicture(req.params.phone);
        res.json({ success: true, url });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
