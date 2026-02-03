const Bull = require('bull');
const db = require('../config/database');
const WhatsAppService = require('./whatsappService');

class QueueService {
    constructor() {
        this.messageQueue = new Bull('message-queue', {
            redis: {
                host: process.env.REDIS_HOST || 'localhost',
                port: process.env.REDIS_PORT || 6379
            },
            defaultJobOptions: {
                removeOnComplete: 100,
                removeOnFail: 100,
                attempts: 3,
                backoff: {
                    type: 'exponential',
                    delay: 5000
                }
            }
        });

        this.campaignQueue = new Bull('campaign-queue', {
            redis: {
                host: process.env.REDIS_HOST || 'localhost',
                port: process.env.REDIS_PORT || 6379
            }
        });

        this.scheduledQueue = new Bull('scheduled-queue', {
            redis: {
                host: process.env.REDIS_HOST || 'localhost',
                port: process.env.REDIS_PORT || 6379
            }
        });

        this.initializeProcessors();
    }

    initializeProcessors() {
        // Process individual messages
        this.messageQueue.process(async (job) => {
            const { userId, phone, message, options, messageId } = job.data;
            
            const instance = global.whatsappInstances.get(userId);
            if (!instance || !instance.isConnected) {
                throw new Error('WhatsApp not connected');
            }

            try {
                const result = await instance.sendMessage(phone, message, options);
                
                await db.Message.update(
                    { 
                        status: 'sent', 
                        whatsappMessageId: result.messageId,
                        sentAt: new Date()
                    },
                    { where: { id: messageId } }
                );

                return result;
            } catch (error) {
                await db.Message.update(
                    { status: 'failed', errorMessage: error.message },
                    { where: { id: messageId } }
                );
                throw error;
            }
        });

        // Process campaigns
        this.campaignQueue.process(async (job) => {
            const { campaignId } = job.data;
            await this.processCampaign(campaignId);
        });

        // Process scheduled messages
        this.scheduledQueue.process(async (job) => {
            const { scheduledMessageId } = job.data;
            await this.processScheduledMessage(scheduledMessageId);
        });

        // Queue event listeners
        this.messageQueue.on('failed', async (job, error) => {
            console.error(`Message job ${job.id} failed:`, error.message);
        });

        this.messageQueue.on('completed', (job, result) => {
            console.log(`Message job ${job.id} completed`);
        });
    }

    async addMessage(data) {
        return await this.messageQueue.add(data, {
            priority: data.priority || 5
        });
    }

    async addCampaign(campaignId, delay = 0) {
        return await this.campaignQueue.add(
            { campaignId },
            { delay }
        );
    }

    async addScheduledMessage(scheduledMessageId, scheduledAt) {
        const delay = new Date(scheduledAt).getTime() - Date.now();
        return await this.scheduledQueue.add(
            { scheduledMessageId },
            { delay: Math.max(delay, 0) }
        );
    }

    async processCampaign(campaignId) {
        const campaign = await db.Campaign.findByPk(campaignId);
        if (!campaign) return;

        await campaign.update({ status: 'running', startedAt: new Date() });

        const instance = global.whatsappInstances.get(campaign.userId);
        if (!instance || !instance.isConnected) {
            await campaign.update({ status: 'failed' });
            return;
        }

        // Get contacts
        let contacts = [];
        if (campaign.targetGroups.length > 0) {
            contacts = await db.Contact.findAll({
                where: {
                    userId: campaign.userId,
                    groupId: campaign.targetGroups,
                    isBlocked: false
                }
            });
        }

        if (campaign.targetContacts.length > 0) {
            const directContacts = await db.Contact.findAll({
                where: {
                    userId: campaign.userId,
                    id: campaign.targetContacts,
                    isBlocked: false
                }
            });
            contacts = [...contacts, ...directContacts];
        }

        // Remove duplicates
        const uniqueContacts = [...new Map(contacts.map(c => [c.phone, c])).values()];

        await campaign.update({ totalContacts: uniqueContacts.length });

        const settings = campaign.settings;
        let sentCount = 0;
        let failedCount = 0;

        for (const contact of uniqueContacts) {
            try {
                // Check if campaign is paused
                const currentCampaign = await db.Campaign.findByPk(campaignId);
                if (currentCampaign.status === 'paused') {
                    break;
                }

                let message = campaign.message;
                message = instance.replaceVariables(message, {
                    name: contact.name,
                    phone: contact.phone,
                    ...contact.variables
                });

                const result = await instance.sendMessage(contact.phone, message, {
                    mediaType: campaign.mediaType,
                    mediaUrl: campaign.mediaUrl
                });

                await db.Message.create({
                    userId: campaign.userId,
                    campaignId,
                    phone: contact.phone,
                    message,
                    mediaType: campaign.mediaType,
                    mediaUrl: campaign.mediaUrl,
                    status: 'sent',
                    whatsappMessageId: result.messageId,
                    sentAt: new Date(),
                    source: 'campaign'
                });

                sentCount++;
                await campaign.update({ sentCount });

                // Update contact
                await contact.update({
                    lastContacted: new Date(),
                    messageCount: contact.messageCount + 1
                });

                // Random delay
                const delay = Math.floor(Math.random() * (settings.maxDelay - settings.minDelay + 1)) + settings.minDelay;
                await new Promise(resolve => setTimeout(resolve, delay));

            } catch (error) {
                failedCount++;
                await campaign.update({ failedCount });

                await db.Message.create({
                    userId: campaign.userId,
                    campaignId,
                    phone: contact.phone,
                    message: campaign.message,
                    status: 'failed',
                    errorMessage: error.message,
                    source: 'campaign'
                });
            }
        }

        await campaign.update({
            status: 'completed',
            completedAt: new Date(),
            deliveredCount: sentCount
        });
    }

    async processScheduledMessage(scheduledMessageId) {
        const scheduled = await db.ScheduledMessage.findByPk(scheduledMessageId);
        if (!scheduled || scheduled.status !== 'pending') return;

        const instance = global.whatsappInstances.get(scheduled.userId);
        if (!instance || !instance.isConnected) {
            await scheduled.update({ status: 'failed' });
            return;
        }

        try {
            await instance.sendMessage(scheduled.phone, scheduled.message, {
                mediaType: scheduled.mediaType,
                mediaUrl: scheduled.mediaUrl
            });

            await scheduled.update({ status: 'sent' });

            // Handle recurring
            if (scheduled.recurring && scheduled.recurringPattern) {
                const nextRun = this.calculateNextRun(scheduled.recurringPattern);
                if (nextRun) {
                    const newScheduled = await db.ScheduledMessage.create({
                        ...scheduled.toJSON(),
                        id: undefined,
                        scheduledAt: nextRun,
                        status: 'pending'
                    });
                    await this.addScheduledMessage(newScheduled.id, nextRun);
                }
            }
        } catch (error) {
            await scheduled.update({ status: 'failed' });
        }
    }

    calculateNextRun(pattern) {
        const now = new Date();
        switch (pattern.type) {
            case 'daily':
                return new Date(now.getTime() + 24 * 60 * 60 * 1000);
            case 'weekly':
                return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
            case 'monthly':
                return new Date(now.setMonth(now.getMonth() + 1));
            default:
                return null;
        }
    }

    async getQueueStats() {
        const [messageStats, campaignStats, scheduledStats] = await Promise.all([
            this.messageQueue.getJobCounts(),
            this.campaignQueue.getJobCounts(),
            this.scheduledQueue.getJobCounts()
        ]);

        return {
            messages: messageStats,
            campaigns: campaignStats,
            scheduled: scheduledStats
        };
    }
}

module.exports = new QueueService();
