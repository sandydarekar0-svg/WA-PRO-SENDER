const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, 
    fetchLatestBaileysVersion, makeInMemoryStore, delay } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode');
const db = require('../config/database');

class WhatsAppService {
    constructor(userId) {
        this.userId = userId;
        this.socket = null;
        this.store = null;
        this.qrCode = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
    }

    async initialize() {
        const sessionPath = path.join(__dirname, '..', 'sessions', this.userId);
        
        if (!fs.existsSync(sessionPath)) {
            fs.mkdirSync(sessionPath, { recursive: true });
        }

        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        const { version } = await fetchLatestBaileysVersion();

        this.store = makeInMemoryStore({
            logger: pino({ level: 'silent' })
        });

        this.socket = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            auth: state,
            browser: ['WhatsApp Bulk Sender', 'Chrome', '120.0.0'],
            getMessage: async (key) => {
                const msg = await this.store.loadMessage(key.remoteJid, key.id);
                return msg?.message || undefined;
            }
        });

        this.store.bind(this.socket.ev);
        this.setupEventHandlers(saveCreds);

        return this;
    }

    setupEventHandlers(saveCreds) {
        // Connection updates
        this.socket.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                this.qrCode = await qrcode.toDataURL(qr);
                this.emitToUser('qr-code', { qr: this.qrCode });
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

                this.isConnected = false;
                this.emitToUser('connection-status', { 
                    status: 'disconnected',
                    reason: statusCode
                });

                if (shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
                    this.reconnectAttempts++;
                    setTimeout(() => this.initialize(), 5000);
                } else if (statusCode === DisconnectReason.loggedOut) {
                    await this.clearSession();
                    await db.User.update(
                        { whatsappConnected: false, whatsappNumber: null },
                        { where: { id: this.userId } }
                    );
                }
            }

            if (connection === 'open') {
                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.qrCode = null;

                const phoneNumber = this.socket.user?.id?.split(':')[0];
                
                await db.User.update(
                    { whatsappConnected: true, whatsappNumber: phoneNumber },
                    { where: { id: this.userId } }
                );

                this.emitToUser('connection-status', { 
                    status: 'connected',
                    phone: phoneNumber
                });
            }
        });

        // Credentials update
        this.socket.ev.on('creds.update', saveCreds);

        // Message status updates
        this.socket.ev.on('messages.update', async (messages) => {
            for (const msg of messages) {
                if (msg.update.status) {
                    const statusMap = {
                        2: 'sent',
                        3: 'delivered',
                        4: 'read'
                    };
                    
                    const status = statusMap[msg.update.status];
                    if (status && msg.key.id) {
                        await db.Message.update(
                            { 
                                status,
                                ...(status === 'delivered' && { deliveredAt: new Date() }),
                                ...(status === 'read' && { readAt: new Date() })
                            },
                            { where: { whatsappMessageId: msg.key.id } }
                        );

                        this.emitToUser('message-status', {
                            messageId: msg.key.id,
                            status
                        });
                    }
                }
            }
        });

        // Incoming messages
        this.socket.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type === 'notify') {
                for (const msg of messages) {
                    if (!msg.key.fromMe) {
                        this.emitToUser('incoming-message', {
                            from: msg.key.remoteJid,
                            message: msg.message,
                            timestamp: msg.messageTimestamp
                        });
                    }
                }
            }
        });
    }

    async sendMessage(phone, message, options = {}) {
        if (!this.isConnected) {
            throw new Error('WhatsApp not connected');
        }

        const jid = this.formatPhoneNumber(phone);
        let sentMessage;

        try {
            // Check if number exists on WhatsApp
            const [result] = await this.socket.onWhatsApp(jid.replace('@s.whatsapp.net', ''));
            if (!result?.exists) {
                throw new Error('Number not registered on WhatsApp');
            }

            // Handle different media types
            if (options.mediaType && options.mediaUrl) {
                switch (options.mediaType) {
                    case 'image':
                        sentMessage = await this.socket.sendMessage(jid, {
                            image: { url: options.mediaUrl },
                            caption: message
                        });
                        break;
                    case 'video':
                        sentMessage = await this.socket.sendMessage(jid, {
                            video: { url: options.mediaUrl },
                            caption: message
                        });
                        break;
                    case 'document':
                        sentMessage = await this.socket.sendMessage(jid, {
                            document: { url: options.mediaUrl },
                            fileName: options.fileName || 'document',
                            caption: message
                        });
                        break;
                    case 'audio':
                        sentMessage = await this.socket.sendMessage(jid, {
                            audio: { url: options.mediaUrl },
                            ptt: options.ptt || false
                        });
                        break;
                    default:
                        sentMessage = await this.socket.sendMessage(jid, { text: message });
                }
            } else if (options.buttons && options.buttons.length > 0) {
                // Button message
                const buttons = options.buttons.map((btn, idx) => ({
                    buttonId: `btn_${idx}`,
                    buttonText: { displayText: btn.text },
                    type: 1
                }));

                sentMessage = await this.socket.sendMessage(jid, {
                    text: message,
                    buttons,
                    footer: options.footer || ''
                });
            } else if (options.listSections) {
                // List message
                sentMessage = await this.socket.sendMessage(jid, {
                    text: message,
                    buttonText: options.buttonText || 'Select',
                    sections: options.listSections,
                    footer: options.footer || ''
                });
            } else {
                // Regular text message
                sentMessage = await this.socket.sendMessage(jid, { text: message });
            }

            return {
                success: true,
                messageId: sentMessage.key.id,
                timestamp: new Date()
            };
        } catch (error) {
            throw error;
        }
    }

    async sendBulkMessages(messages, settings = {}) {
        const results = [];
        const minDelay = settings.minDelay || 3000;
        const maxDelay = settings.maxDelay || 8000;
        const batchSize = settings.batchSize || 50;
        const batchDelay = settings.batchDelay || 60000;

        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];

            try {
                // Process spintax if enabled
                let processedMessage = msg.message;
                if (settings.useSpintax) {
                    processedMessage = this.processSpintax(processedMessage);
                }

                // Replace variables
                processedMessage = this.replaceVariables(processedMessage, msg.variables || {});

                const result = await this.sendMessage(msg.phone, processedMessage, {
                    mediaType: msg.mediaType,
                    mediaUrl: msg.mediaUrl,
                    buttons: msg.buttons,
                    footer: msg.footer
                });

                results.push({
                    phone: msg.phone,
                    success: true,
                    messageId: result.messageId
                });

                this.emitToUser('message-sent', {
                    phone: msg.phone,
                    success: true,
                    progress: ((i + 1) / messages.length * 100).toFixed(2)
                });

            } catch (error) {
                results.push({
                    phone: msg.phone,
                    success: false,
                    error: error.message
                });

                this.emitToUser('message-failed', {
                    phone: msg.phone,
                    error: error.message
                });
            }

            // Random delay between messages
            const randomDelay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
            await delay(randomDelay);

            // Batch delay
            if ((i + 1) % batchSize === 0 && i < messages.length - 1) {
                this.emitToUser('batch-pause', {
                    message: `Pausing for ${batchDelay / 1000} seconds after ${batchSize} messages...`
                });
                await delay(batchDelay);
            }
        }

        return results;
    }

    processSpintax(text) {
        const regex = /\{([^{}]+)\}/g;
        return text.replace(regex, (match, group) => {
            const options = group.split('|');
            return options[Math.floor(Math.random() * options.length)];
        });
    }

    replaceVariables(text, variables) {
        let result = text;
        for (const [key, value] of Object.entries(variables)) {
            const regex = new RegExp(`{{${key}}}`, 'gi');
            result = result.replace(regex, value || '');
        }
        return result;
    }

    formatPhoneNumber(phone) {
        let cleaned = phone.replace(/\D/g, '');
        if (!cleaned.startsWith('1') && cleaned.length === 10) {
            cleaned = '1' + cleaned; // Add US country code
        }
        return `${cleaned}@s.whatsapp.net`;
    }

    async checkNumber(phone) {
        if (!this.isConnected) {
            throw new Error('WhatsApp not connected');
        }

        const jid = this.formatPhoneNumber(phone);
        const [result] = await this.socket.onWhatsApp(jid.replace('@s.whatsapp.net', ''));
        return result?.exists || false;
    }

    async getProfilePicture(phone) {
        if (!this.isConnected) {
            throw new Error('WhatsApp not connected');
        }

        const jid = this.formatPhoneNumber(phone);
        try {
            const ppUrl = await this.socket.profilePictureUrl(jid, 'image');
            return ppUrl;
        } catch {
            return null;
        }
    }

    async getStatus() {
        return {
            connected: this.isConnected,
            phone: this.socket?.user?.id?.split(':')[0] || null,
            qrCode: this.qrCode
        };
    }

    async logout() {
        if (this.socket) {
            await this.socket.logout();
        }
        await this.clearSession();
    }

    async clearSession() {
        const sessionPath = path.join(__dirname, '..', 'sessions', this.userId);
        if (fs.existsSync(sessionPath)) {
            fs.rmSync(sessionPath, { recursive: true, force: true });
        }
        global.whatsappInstances.delete(this.userId);
    }

    emitToUser(event, data) {
        if (global.io) {
            global.io.to(`user-${this.userId}`).emit(event, data);
        }
    }
}

module.exports = WhatsAppService;
