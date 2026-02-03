const express = require('express');
const router = express.Router();
const multer = require('multer');
const xlsx = require('xlsx');
const { authMiddleware } = require('../middleware/auth');
const db = require('../config/database');

const upload = multer({ storage: multer.memoryStorage() });

// Get all contact groups
router.get('/groups', authMiddleware, async (req, res) => {
    try {
        const groups = await db.ContactGroup.findAll({
            where: { userId: req.user.id },
            order: [['createdAt', 'DESC']]
        });
        res.json({ success: true, groups });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create contact group
router.post('/groups', authMiddleware, async (req, res) => {
    try {
        const { name, description, color } = req.body;
        
        const group = await db.ContactGroup.create({
            userId: req.user.id,
            name,
            description,
            color
        });

        res.status(201).json({ success: true, group });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update contact group
router.put('/groups/:id', authMiddleware, async (req, res) => {
    try {
        const group = await db.ContactGroup.findOne({
            where: { id: req.params.id, userId: req.user.id }
        });
        
        if (!group) {
            return res.status(404).json({ error: 'Group not found' });
        }

        const { name, description, color } = req.body;
        await group.update({ name, description, color });

        res.json({ success: true, group });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete contact group
router.delete('/groups/:id', authMiddleware, async (req, res) => {
    try {
        const group = await db.ContactGroup.findOne({
            where: { id: req.params.id, userId: req.user.id }
        });
        
        if (!group) {
            return res.status(404).json({ error: 'Group not found' });
        }

        // Move contacts to no group
        await db.Contact.update(
            { groupId: null },
            { where: { groupId: group.id } }
        );

        await group.destroy();
        res.json({ success: true, message: 'Group deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get all contacts
router.get('/', authMiddleware, async (req, res) => {
    try {
        const { groupId, search, page = 1, limit = 50 } = req.query;
        
        const where = { userId: req.user.id };
        
        if (groupId) {
            where.groupId = groupId;
        }
        
        if (search) {
            where[db.Sequelize.Op.or] = [
                { phone: { [db.Sequelize.Op.like]: `%${search}%` } },
                { name: { [db.Sequelize.Op.like]: `%${search}%` } }
            ];
        }

        const offset = (page - 1) * limit;
        
        const { count, rows: contacts } = await db.Contact.findAndCountAll({
            where,
            include: [{ model: db.ContactGroup, attributes: ['id', 'name', 'color'] }],
            order: [['createdAt', 'DESC']],
            limit: parseInt(limit),
            offset
        });

        res.json({ 
            success: true, 
            contacts,
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

// Add single contact
router.post('/', authMiddleware, async (req, res) => {
    try {
        const { phone, name, email, groupId, variables, tags } = req.body;

        // Check if contact exists
        const existing = await db.Contact.findOne({
            where: { userId: req.user.id, phone }
        });

        if (existing) {
            return res.status(400).json({ error: 'Contact already exists' });
        }

        const contact = await db.Contact.create({
            userId: req.user.id,
            phone,
            name,
            email,
            groupId,
            variables: variables || {},
            tags: tags || []
        });

        // Update group count
        if (groupId) {
            await db.ContactGroup.increment('contactCount', {
                where: { id: groupId }
            });
        }

        res.status(201).json({ success: true, contact });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Import contacts from file
router.post('/import', authMiddleware, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const { groupId } = req.body;
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

        const results = { success: 0, failed: 0, duplicates: 0 };
        
        for (const row of data) {
            const phone = String(row.phone || row.Phone || row.PHONE || '').replace(/\D/g, '');
            
            if (!phone) {
                results.failed++;
                continue;
            }

            try {
                const existing = await db.Contact.findOne({
                    where: { userId: req.user.id, phone }
                });

                if (existing) {
                    results.duplicates++;
                    continue;
                }

                await db.Contact.create({
                    userId: req.user.id,
                    phone,
                    name: row.name || row.Name || row.NAME || '',
                    email: row.email || row.Email || row.EMAIL || '',
                    groupId: groupId || null,
                    variables: {
                        var1: row.var1 || row.variable1 || '',
                        var2: row.var2 || row.variable2 || '',
                        var3: row.var3 || row.variable3 || ''
                    }
                });

                results.success++;
            } catch (err) {
                results.failed++;
            }
        }

        // Update group count
        if (groupId) {
            const count = await db.Contact.count({
                where: { userId: req.user.id, groupId }
            });
            await db.ContactGroup.update(
                { contactCount: count },
                { where: { id: groupId } }
            );
        }

        res.json({ success: true, results });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Export contacts
router.get('/export', authMiddleware, async (req, res) => {
    try {
        const { groupId } = req.query;
        
        const where = { userId: req.user.id };
        if (groupId) where.groupId = groupId;

        const contacts = await db.Contact.findAll({ where });

        const data = contacts.map(c => ({
            phone: c.phone,
            name: c.name,
            email: c.email,
            ...c.variables
        }));

        const worksheet = xlsx.utils.json_to_sheet(data);
        const workbook = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(workbook, worksheet, 'Contacts');

        const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Disposition', 'attachment; filename=contacts.xlsx');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update contact
router.put('/:id', authMiddleware, async (req, res) => {
    try {
        const contact = await db.Contact.findOne({
            where: { id: req.params.id, userId: req.user.id }
        });
        
        if (!contact) {
            return res.status(404).json({ error: 'Contact not found' });
        }

        const oldGroupId = contact.groupId;
        const { phone, name, email, groupId, variables, tags, isBlocked } = req.body;

        await contact.update({ phone, name, email, groupId, variables, tags, isBlocked });

        // Update group counts
        if (oldGroupId !== groupId) {
            if (oldGroupId) {
                await db.ContactGroup.decrement('contactCount', {
                    where: { id: oldGroupId }
                });
            }
            if (groupId) {
                await db.ContactGroup.increment('contactCount', {
                    where: { id: groupId }
                });
            }
        }

        res.json({ success: true, contact });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete contact
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const contact = await db.Contact.findOne({
            where: { id: req.params.id, userId: req.user.id }
        });
        
        if (!contact) {
            return res.status(404).json({ error: 'Contact not found' });
        }

        if (contact.groupId) {
            await db.ContactGroup.decrement('contactCount', {
                where: { id: contact.groupId }
            });
        }

        await contact.destroy();
        res.json({ success: true, message: 'Contact deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Bulk delete contacts
router.post('/bulk-delete', authMiddleware, async (req, res) => {
    try {
        const { contactIds } = req.body;
        
        await db.Contact.destroy({
            where: {
                id: contactIds,
                userId: req.user.id
            }
        });

        res.json({ success: true, message: 'Contacts deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Move contacts to group
router.post('/move-to-group', authMiddleware, async (req, res) => {
    try {
        const { contactIds, groupId } = req.body;

        await db.Contact.update(
            { groupId },
            { where: { id: contactIds, userId: req.user.id } }
        );

        // Update group counts
        const groups = await db.ContactGroup.findAll({
            where: { userId: req.user.id }
        });

        for (const group of groups) {
            const count = await db.Contact.count({
                where: { userId: req.user.id, groupId: group.id }
            });
            await group.update({ contactCount: count });
        }

        res.json({ success: true, message: 'Contacts moved' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
