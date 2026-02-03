const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const db = require('../config/database');
const { Op } = require('sequelize');

// Get dashboard stats
router.get('/dashboard', authMiddleware, async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

        // Messages stats
        const [todayMessages, monthMessages, totalMessages] = await Promise.all([
            db.Message.count({
                where: {
                    userId: req.user.id,
                    createdAt: { [Op.gte]: today }
                }
            }),
            db.Message.count({
                where: {
                    userId: req.user.id,
                    createdAt: { [Op.gte]: startOfMonth }
                }
            }),
            db.Message.count({
                where: { userId: req.user.id }
            })
        ]);

        // Status breakdown
        const statusBreakdown = await db.Message.findAll({
            where: { userId: req.user.id },
            attributes: [
                'status',
                [db.Sequelize.fn('COUNT', db.Sequelize.col('id')), 'count']
            ],
            group: ['status']
        });

        // Contacts stats
        const totalContacts = await db.Contact.count({
            where: { userId: req.user.id }
        });

        // Campaigns stats
        const campaigns = await db.Campaign.findAll({
            where: { userId: req.user.id },
            attributes: [
                'status',
                [db.Sequelize.fn('COUNT', db.Sequelize.col('id')), 'count']
            ],
            group: ['status']
        });

        // Recent activity (last 7 days)
        const last7Days = new Date(today);
        last7Days.setDate(last7Days.getDate() - 7);

        const dailyStats = await db.Message.findAll({
            where: {
                userId: req.user.id,
                createdAt: { [Op.gte]: last7Days }
            },
            attributes: [
                [db.Sequelize.fn('DATE', db.Sequelize.col('createdAt')), 'date'],
                [db.Sequelize.fn('COUNT', db.Sequelize.col('id')), 'count']
            ],
            group: [db.Sequelize.fn('DATE', db.Sequelize.col('createdAt'))],
            order: [[db.Sequelize.fn('DATE', db.Sequelize.col('createdAt')), 'ASC']]
        });

        res.json({
            success: true,
            stats: {
                messages: {
                    today: todayMessages,
                    month: monthMessages,
                    total: totalMessages,
                    breakdown: statusBreakdown
                },
                contacts: totalContacts,
                campaigns,
                dailyStats,
                limits: {
                    daily: req.user.dailyLimit,
                    usedToday: req.user.messagesUsedToday,
                    monthly: req.user.monthlyLimit,
                    usedMonth: req.user.messagesUsedMonth
                }
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get message history
router.get('/messages', authMiddleware, async (req, res) => {
    try {
        const { 
            status, 
            source, 
            startDate, 
            endDate, 
            page = 1, 
            limit = 50 
        } = req.query;

        const where = { userId: req.user.id };
        
        if (status) where.status = status;
        if (source) where.source = source;
        if (startDate || endDate) {
            where.createdAt = {};
            if (startDate) where.createdAt[Op.gte] = new Date(startDate);
            if (endDate) where.createdAt[Op.lte] = new Date(endDate);
        }

        const offset = (page - 1) * limit;

        const { count, rows: messages } = await db.Message.findAndCountAll({
            where,
            order: [['createdAt', 'DESC']],
            limit: parseInt(limit),
            offset
        });

        res.json({
            success: true,
            messages,
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

// Get delivery rate over time
router.get('/delivery-rate', authMiddleware, async (req, res) => {
    try {
        const { days = 30 } = req.query;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - parseInt(days));

        const messages = await db.Message.findAll({
            where: {
                userId: req.user.id,
                createdAt: { [Op.gte]: startDate }
            },
            attributes: [
                [db.Sequelize.fn('DATE', db.Sequelize.col('createdAt')), 'date'],
                'status',
                [db.Sequelize.fn('COUNT', db.Sequelize.col('id')), 'count']
            ],
            group: [
                db.Sequelize.fn('DATE', db.Sequelize.col('createdAt')),
                'status'
            ],
            order: [[db.Sequelize.fn('DATE', db.Sequelize.col('createdAt')), 'ASC']]
        });

        res.json({ success: true, data: messages });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Export reports
router.get('/export', authMiddleware, async (req, res) => {
    try {
        const { type, startDate, endDate, format = 'json' } = req.query;

        const where = { userId: req.user.id };
        if (startDate || endDate) {
            where.createdAt = {};
            if (startDate) where.createdAt[Op.gte] = new Date(startDate);
            if (endDate) where.createdAt[Op.lte] = new Date(endDate);
        }

        let data;
        switch (type) {
            case 'messages':
                data = await db.Message.findAll({ where });
                break;
            case 'campaigns':
                data = await db.Campaign.findAll({ where });
                break;
            default:
                return res.status(400).json({ error: 'Invalid report type' });
        }

        if (format === 'csv') {
            // Convert to CSV
            const fields = Object.keys(data[0]?.toJSON() || {});
            const csv = [
                fields.join(','),
                ...data.map(row => 
                    fields.map(f => JSON.stringify(row[f] || '')).join(',')
                )
            ].join('\n');

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename=${type}-report.csv`);
            return res.send(csv);
        }

        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
