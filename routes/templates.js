const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const db = require('../config/database');

// Get all templates
router.get('/', authMiddleware, async (req, res) => {
    try {
        const templates = await db.Template.findAll({
            where: { userId: req.user.id },
            order: [['createdAt', 'DESC']]
        });
        res.json({ success: true, templates });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get template by ID
router.get('/:id', authMiddleware, async (req, res) => {
    try {
        const template = await db.Template.findOne({
            where: { id: req.params.id, userId: req.user.id }
        });
        
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }
        
        res.json({ success: true, template });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create template
router.post('/', authMiddleware, async (req, res) => {
    try {
        const { name, category, content, mediaType, mediaUrl, buttons, footer, useSpintax } = req.body;

        // Extract variables from content
        const variableRegex = /\{\{(\w+)\}\}/g;
        const variables = [];
        let match;
        while ((match = variableRegex.exec(content)) !== null) {
            if (!variables.includes(match[1])) {
                variables.push(match[1]);
            }
        }

        const template = await db.Template.create({
            userId: req.user.id,
            name,
            category,
            content,
            variables,
            mediaType: mediaType || 'none',
            mediaUrl,
            buttons: buttons || [],
            footer,
            useSpintax: useSpintax || false
        });

        res.status(201).json({ success: true, template });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update template
router.put('/:id', authMiddleware, async (req, res) => {
    try {
        const template = await db.Template.findOne({
            where: { id: req.params.id, userId: req.user.id }
        });
        
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }

        const { name, category, content, mediaType, mediaUrl, buttons, footer, useSpintax, isActive } = req.body;

        // Re-extract variables
        const variableRegex = /\{\{(\w+)\}\}/g;
        const variables = [];
        let match;
        while ((match = variableRegex.exec(content)) !== null) {
            if (!variables.includes(match[1])) {
                variables.push(match[1]);
            }
        }

        await template.update({
            name,
            category,
            content,
            variables,
            mediaType,
            mediaUrl,
            buttons,
            footer,
            useSpintax,
            isActive
        });

        res.json({ success: true, template });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete template
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const template = await db.Template.findOne({
            where: { id: req.params.id, userId: req.user.id }
        });
        
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }

        await template.destroy();
        res.json({ success: true, message: 'Template deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Duplicate template
router.post('/:id/duplicate', authMiddleware, async (req, res) => {
    try {
        const original = await db.Template.findOne({
            where: { id: req.params.id, userId: req.user.id }
        });
        
        if (!original) {
            return res.status(404).json({ error: 'Template not found' });
        }

        const template = await db.Template.create({
            ...original.toJSON(),
            id: undefined,
            name: `${original.name} (Copy)`,
            usageCount: 0,
            createdAt: undefined,
            updatedAt: undefined
        });

        res.status(201).json({ success: true, template });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Preview template with variables
router.post('/:id/preview', authMiddleware, async (req, res) => {
    try {
        const template = await db.Template.findOne({
            where: { id: req.params.id, userId: req.user.id }
        });
        
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }

        const { variables } = req.body;
        let preview = template.content;

        for (const [key, value] of Object.entries(variables)) {
            preview = preview.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
        }

        // Process spintax for preview
        if (template.useSpintax) {
            preview = preview.replace(/\{([^{}]+)\}/g, (match, group) => {
                const options = group.split('|');
                return options[Math.floor(Math.random() * options.length)];
            });
        }

        res.json({ success: true, preview });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
