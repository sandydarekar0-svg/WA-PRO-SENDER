const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const db = require('../config/database');

// Get all campaigns
router.get('/', authMiddleware, async (req, res) => {
    try {
        const { status, page = 1, limit = 20 } = req.query;
        const where = { userId: req.user.id };
        
        if (status && status !== 'all') {
            where.status = status;
        }

        const offset = (page - 1) * limit;
        
        const { count, rows: campaigns } = await db.Campaign.findAndCountAll({
            where,
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
        console.error('Get campaigns error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get single campaign
router.get('/:id', authMiddleware, async (req, res) => {
    try {
        const campaign = await db.Campaign.findOne({
            where: { id: req.params.id, userId: req.user.id }
        });
        
        if (!campaign) {
            return res.status(404).json({ error: 'Campaign not found' });
        }

        // Get message stats
        const stats = await db.Message.findAll({
            where: { campaignId: campaign.id },
            attributes: [
                'status',
                [db.Sequelize.fn('COUNT', db.Sequelize.col('id')), 'count']
            ],
            group: ['status']
        });
        
        res.json({ success: true, campaign, stats });
    } catch (error) {
        console.error('Get campaign error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Create campaign
router.post('/', authMiddleware, async (req, res) => {
    try {
        const { 
            name, 
            message, 
            mediaType, 
            mediaUrl,
            targetType,
            targetGroups, 
            targetNumbers,
            scheduledAt,
            settings
        } = req.body;

        console.log('Creating campaign:', { name, targetType });

        if (!name || !message) {
            return res.status(400).json({ error: 'Name and message are required' });
        }

        // Get target contacts count
        let totalContacts = 0;
        let contactsList = [];

        if (targetType === 'groups' && targetGroups && targetGroups.length > 0) {
            const contacts = await db.Contact.findAll({
                where: {
                    userId: req.user.id,
                    groupId: targetGroups,
                    isBlocked: false
                }
            });
            contactsList = contacts.map(c => c.phone);
            totalContacts = contactsList.length;
        } else if (targetType === 'numbers' && targetNumbers) {
            contactsList = targetNumbers.split('\n')
                .map(n => n.trim())
                .filter(n => n.length > 5);
            totalContacts = contactsList.length;
        }

        if (totalContacts === 0) {
            return res.status(400).json({ error: 'No valid contacts found' });
        }

        const campaign = await db.Campaign.create({
            userId: req.user.id,
            name,
            message,
            mediaType: mediaType || 'none',
            mediaUrl,
            targetGroups: targetGroups || [],
            targetContacts: contactsList,
            totalContacts,
            status: scheduledAt ? 'scheduled' : 'draft',
            type: scheduledAt ? 'scheduled' : 'instant',
            scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
            settings: settings || {
                minDelay: 3000,
                maxDelay: 8000,
                batchSize: 50
            }
        });

        console.log('Campaign created:', campaign.id);

        res.status(201).json({ success: true, campaign });
    } catch (error) {
        console.error('Create campaign error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update campaign
router.put('/:id', authMiddleware, async (req, res) => {
    try {
        const campaign = await db.Campaign.findOne({
            where: { id: req.params.id, userId: req.user.id }
        });
        
        if (!campaign) {
            return res.status(404).json({ error: 'Campaign not found' });
        }

        if (campaign.status === 'running') {
            return res.status(400).json({ error: 'Cannot edit running campaign' });
        }

        const { name, message, mediaType, mediaUrl, scheduledAt, settings } = req.body;

        await campaign.update({
            name,
            message,
            mediaType,
            mediaUrl,
            scheduledAt,
            settings
        });

        res.json({ success: true, campaign });
    } catch (error) {
        console.error('Update campaign error:', error);
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

        if (campaign.status === 'completed') {
            return res.status(400).json({ error: 'Campaign already completed' });
        }

        // Check WhatsApp connection
        const instance = global.whatsappInstances.get(req.user.id);
        if (!instance || !instance.isConnected) {
            return res.status(400).json({ error: 'WhatsApp not connected. Please connect first.' });
        }

        // Update campaign status
        await campaign.update({ 
            status: 'running', 
            startedAt: new Date() 
        });

        // Start sending in background
        processCampaign(campaign, instance, req.user.id);

        res.json({ success: true, message: 'Campaign started', campaign });
    } catch (error) {
        console.error('Start campaign error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Process campaign (background function)
async function processCampaign(campaign, waInstance, userId) {
    console.log(`[Campaign] Starting: ${campaign.id}`);
    
    const contacts = campaign.targetContacts || [];
    const settings = campaign.settings || {};
    const minDelay = settings.minDelay || 3000;
    const maxDelay = settings.maxDelay || 8000;

    let sentCount = 0;
    let failedCount = 0;

    for (let i = 0; i < contacts.length; i++) {
        const phone = contacts[i];
        
        try {
            // Check if campaign was paused/cancelled
            const currentCampaign = await db.Campaign.findByPk(campaign.id);
            if (currentCampaign.status === 'paused' || currentCampaign.status === 'cancelled') {
                console.log(`[Campaign] ${campaign.id} was ${currentCampaign.status}`);
                break;
            }

            // Process message with variables
            let processedMessage = campaign.message;
            processedMessage = waInstance.replaceVariables(processedMessage, {
                phone: phone,
                name: ''
            });

            // Send message
            const result = await waInstance.sendMessage(phone, processedMessage, {
                mediaType: campaign.mediaType !== 'none' ? campaign.mediaType : null,
                mediaUrl: campaign.mediaUrl
            });

            // Save to messages table
            await db.Message.create({
                userId,
                campaignId: campaign.id,
                phone,
                message: processedMessage,
                mediaType: campaign.mediaType,
                mediaUrl: campaign.mediaUrl,
                status: 'sent',
                whatsappMessageId: result.messageId,
                sentAt: new Date(),
                source: 'campaign'
            });

            sentCount++;
            
            // Update campaign progress
            await campaign.update({ 
                sentCount,
                deliveredCount: sentCount
            });

            // Emit progress
            if (global.io) {
                global.io.to(`user-${userId}`).emit('campaign-progress', {
                    campaignId: campaign.id,
                    phone,
                    success: true,
                    sent: sentCount,
                    failed: failedCount,
                    total: contacts.length,
                    progress: ((sentCount + failedCount) / contacts.length * 100).toFixed(1)
                });
            }

            console.log(`[Campaign] ${campaign.id}: Sent ${sentCount}/${contacts.length} to ${phone}`);

        } catch (error) {
            console.error(`[Campaign] Failed to send to ${phone}:`, error.message);
            
            failedCount++;
            
            await db.Message.create({
                userId,
                campaignId: campaign.id,
                phone,
                message: campaign.message,
                status: 'failed',
                errorMessage: error.message,
                source: 'campaign'
            });

            await campaign.update({ failedCount });

            if (global.io) {
                global.io.to(`user-${userId}`).emit('campaign-progress', {
                    campaignId: campaign.id,
                    phone,
                    success: false,
                    error: error.message,
                    sent: sentCount,
                    failed: failedCount,
                    total: contacts.length
                });
            }
        }

        // Delay between messages
        if (i < contacts.length - 1) {
            const delay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    // Complete campaign
    await campaign.update({
        status: 'completed',
        completedAt: new Date(),
        sentCount,
        failedCount,
        deliveredCount: sentCount
    });

    console.log(`[Campaign] ${campaign.id} completed: ${sentCount} sent, ${failedCount} failed`);

    if (global.io) {
        global.io.to(`user-${userId}`).emit('campaign-complete', {
            campaignId: campaign.id,
            sent: sentCount,
            failed: failedCount,
            total: contacts.length
        });
    }
}

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

        const instance = global.whatsappInstances.get(req.user.id);
        if (!instance || !instance.isConnected) {
            return res.status(400).json({ error: 'WhatsApp not connected' });
        }

        await campaign.update({ status: 'running' });
        
        // Resume from where it left off
        processCampaign(campaign, instance, req.user.id);
        
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

        await campaign.update({ 
            status: 'cancelled',
            completedAt: new Date()
        });
        
        res.json({ success: true, message: 'Campaign cancelled', campaign });
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
            return res.status(400).json({ error: 'Cannot delete running campaign. Pause or cancel first.' });
        }

        // Delete related messages
        await db.Message.destroy({ where: { campaignId: campaign.id } });
        
        await campaign.destroy();
        
        res.json({ success: true, message: 'Campaign deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
