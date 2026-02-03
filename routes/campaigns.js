const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const db = require('../config/database');
const QueueService = require('../services/queueService');

// Get all campaigns
router.get('/', authMiddleware, async (req, res) => {
    try {
        const { status, page = 1, limit = 20 } = req.query;
        
        const where = { userId: req.user.id };
        if (status) where.status = status;

        const offset = (page - 1) * limit;
        
        const { count, rows: campaigns } = await db.Campaign.findAndCountAll({
            where,
            include: [{ model: db.Template, attributes: ['id', 'name'] }],
            order: [['createdAt', 'DESC']],
            limit: parseInt(limit),
            offset
        });

        res.json({ 
            success: true, 
            campaigns,
            pagination: {
                total: count,
                page: parseInt(page),
                pages: Math.ceil(count / limit)
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get campaign by ID
router.get('/:id', authMiddleware, async (req, res) => {
    try {
        const campaign = await db.Campaign.findOne({
            where: { id: req.params.id, userId: req.user.id },
            include: [
                { model: db.Template },
                { model: db.Message }
            ]
        });
        
        if (!campaign) {
            return res.status(404).json({ error: 'Campaign not found' });
        }
        
        res.json({ success: true, campaign });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create campaign
router.post('/', authMiddleware, async (req, res) => {
    try {
        const { 
            name, templateId, message, mediaType, mediaUrl, 
            targetGroups, targetContacts, type, scheduledAt, settings 
        } = req.body;

        const campaign = await db.Campaign.create({
            userId: req.user.id,
            name,
            templateId,
            message,
            mediaType: mediaType || 'none',
            mediaUrl,
            targetGroups: targetGroups || [],
            targetContacts: targetContacts || [],
            type: type || 'instant',
            scheduledAt,
            settings: settings || {
                minDelay: 3000,
                maxDelay: 8000,
                batchSize: 50
            }
        });

        res.status(201).json({ success: true, campaign });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Start campaign
router.post('/:id/start', authMiddleware, async (req, res) => {
    try {
        const campaign = await db.Campaign.findOne({
            where: { id: req.params.id, userId: req.user.id }
        });
        
        if (!campaign) {
            return res.status(404).json({ error: 'Campaign not found' });
        }

        if (campaign.status === 'running') {
            return res.status(400).json({ error: 'Campaign is already running' });
        }

        // Check WhatsApp connection
        const instance = global.whatsappInstances.get(req.user.id);
        if (!instance || !instance.isConnected) {
            return res.status(400).json({ error: 'WhatsApp not connected' });
        }

        await campaign.update({ status: 'scheduled' });

        if (campaign.type === 'scheduled' && campaign.scheduledAt) {
            const delay = new Date(campaign.scheduledAt).getTime() - Date.now();
            await QueueService.addCampaign(campaign.id, Math.max(delay, 0));
        } else {
            await QueueService.addCampaign(campaign.id, 0);
        }

        res.json({ success: true, message: 'Campaign started', campaign });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Pause campaign
router.post('/:id/pause', authMiddleware, async (req, res) => {
    try {
        const campaign = await db.Campaign.findOne({
            where: { id: req.params.id, userId: req.user.id }
        });
        
        if (!campaign) {
            return res.status(404).json({ error: 'Campaign not found' });
        }

        await campaign.update({ status: 'paused' });
        res.json({ success: true, message: 'Campaign paused', campaign });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Resume campaign
router.post('/:id/resume', authMiddleware, async (req, res) => {
    try {
        const campaign = await db.Campaign.findOne({
            where: { id: req.params.id, userId: req.user.id }
        });
        
        if (!campaign) {
            return res.status(404).json({ error: 'Campaign not found' });
        }

        await campaign.update({ status: 'running' });
        await QueueService.addCampaign(campaign.id, 0);
        
        res.json({ success: true, message: 'Campaign resumed', campaign });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Cancel campaign
router.post('/:id/cancel', authMiddleware, async (req, res) => {
    try {
        const campaign = await db.Campaign.findOne({
            where: { id: req.params.id, userId: req.user.id }
        });
        
        if (!campaign) {
            return res.status(404).json({ error: 'Campaign not found' });
        }

        await campaign.update({ status: 'failed', completedAt: new Date() });
        res.json({ success: true, message: 'Campaign cancelled', campaign });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get campaign statistics
router.get('/:id/stats', authMiddleware, async (req, res) => {
    try {
        const campaign = await db.Campaign.findOne({
            where: { id: req.params.id, userId: req.user.id }
        });
        
        if (!campaign) {
            return res.status(404).json({ error: 'Campaign not found' });
        }

        const stats = await db.Message.findAll({
            where: { campaignId: campaign.id },
            attributes: [
                'status',
                [db.Sequelize.fn('COUNT', db.Sequelize.col('id')), 'count']
            ],
            group: ['status']
        });

        res.json({ 
            success: true, 
            stats: {
                total: campaign.totalContacts,
                sent: campaign.sentCount,
                delivered: campaign.deliveredCount,
                failed: campaign.failedCount,
                breakdown: stats
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete campaign
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const campaign = await db.Campaign.findOne({
            where: { id: req.params.id, userId: req.user.id }
        });
        
        if (!campaign) {
            return res.status(404).json({ error: 'Campaign not found' });
        }

        if (campaign.status === 'running') {
            return res.status(400).json({ error: 'Cannot delete running campaign' });
        }

        await db.Message.destroy({ where: { campaignId: campaign.id } });
        await campaign.destroy();

        res.json({ success: true, message: 'Campaign deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
