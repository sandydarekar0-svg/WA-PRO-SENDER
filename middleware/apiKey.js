const db = require('../config/database');
const crypto = require('crypto');

const apiKeyMiddleware = async (req, res, next) => {
    try {
        const apiKey = req.headers['x-api-key'];
        const apiSecret = req.headers['x-api-secret'];

        if (!apiKey || !apiSecret) {
            return res.status(401).json({ error: 'API key and secret required' });
        }

        const keyRecord = await db.ApiKey.findOne({
            where: { key: apiKey, isActive: true },
            include: [{ model: db.User }]
        });

        if (!keyRecord) {
            return res.status(401).json({ error: 'Invalid API key' });
        }

        // Verify secret
        const hashedSecret = crypto.createHash('sha256').update(apiSecret).digest('hex');
        if (hashedSecret !== keyRecord.secret) {
            return res.status(401).json({ error: 'Invalid API secret' });
        }

        // Check expiration
        if (keyRecord.expiresAt && new Date(keyRecord.expiresAt) < new Date()) {
            return res.status(401).json({ error: 'API key expired' });
        }

        // Check IP whitelist
        if (keyRecord.allowedIps.length > 0) {
            const clientIp = req.ip || req.connection.remoteAddress;
            if (!keyRecord.allowedIps.includes(clientIp)) {
                return res.status(403).json({ error: 'IP not allowed' });
            }
        }

        // Rate limiting
        const now = Date.now();
        const windowStart = now - keyRecord.rateLimitWindow;
        
        // Simple in-memory rate limiting (use Redis in production)
        if (!global.apiRateLimits) global.apiRateLimits = new Map();
        
        const rateKey = `${apiKey}:${Math.floor(now / keyRecord.rateLimitWindow)}`;
        const currentCount = global.apiRateLimits.get(rateKey) || 0;

        if (currentCount >= keyRecord.rateLimit) {
            return res.status(429).json({ error: 'Rate limit exceeded' });
        }

        global.apiRateLimits.set(rateKey, currentCount + 1);

        // Update last used
        await keyRecord.update({ 
            lastUsed: new Date(),
            requestCount: keyRecord.requestCount + 1
        });

        req.apiKey = keyRecord;
        req.user = keyRecord.User;
        next();
    } catch (error) {
        return res.status(500).json({ error: 'API authentication failed' });
    }
};

module.exports = { apiKeyMiddleware };
