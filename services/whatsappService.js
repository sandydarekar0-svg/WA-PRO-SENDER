const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, 
    fetchLatestBaileysVersion, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode');
const db = require('../config/database');

class WhatsAppService {
    constructor(userId) {
        this.userId = userId;
        this.socket = null;
        this.qrCode = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.qrRetryCount = 0;
        this.maxQrRetries = 5;
    }

    async initialize() {
        try {
            const sessionPath = path.join(__dirname, '..', 'sessions', this.userId);
            
            // Create sessions directory if not exists
            if (!fs.existsSync(sessionPath)) {
                fs.mkdirSync(sessionPath, { recursive: true });
            }

            console.log(`[WA] Initializing for user: ${this.userId}`);
            console.log(`[WA] Session path: ${sessionPath}`);

            const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
            const { version, isLatest } = await fetchLatestBaileysVersion();
            
            console.log(`[WA] Using WA version: ${version.join('.')}, isLatest: ${isLatest}`);

            this.socket = makeWASocket({
                version,
                logger: pino({ level: 'silent' }),
                printQRInTerminal: true, // Also print in terminal for debugging
                auth: state,
                browser: Browsers.ubuntu('Chrome'), // Use proper browser config
                connectTimeoutMs: 60000,
                qrTimeout: 40000,
                defaultQueryTimeoutMs: 60000,
                getMessage: async (key) => {
                    return { conversation: 'hello' };
                }
            });

            this.setupEventHandlers(saveCreds);
            
            return this;
        } catch (error) {
            console.error('[WA] Initialize error:', error);
            throw error;
        }
    }

    setupEventHandlers(saveCreds) {
        // Connection updates
        this.socket.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            console.log('[WA] Connection update:', { connection, hasQr: !!qr });

            // QR Code received
            if (qr) {
                this.qrRetryCount++;
                console.log(`[WA] QR Code received (attempt ${this.qrRetryCount}/${this.maxQrRetries})`);
                
                try {
                    this.qrCode = await qrcode.toDataURL(qr);
                    console.log('[WA] QR Code converted to base64 successfully');
                    
                    // Emit to user
                    this.emitToUser('qr-code', { qr: this.qrCode });
                    console.log('[WA] QR Code emitted to user');
                } catch (err) {
                    console.error('[WA] QR Code generation error:', err);
                }

                if (this.qrRetryCount >= this.maxQrRetries) {
                    console.log('[WA] Max QR retries reached, closing connection');
                    this.emitToUser('qr-timeout', { message: 'QR Code timeout. Please try again.' });
                }
            }

            // Connection closed
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

                console.log(`[WA] Connection closed. Status: ${statusCode}, Reconnect: ${shouldReconnect}`);

                this.isConnected = false;
                this.emitToUser('connection-status', { 
                    status: 'disconnected',
                    reason: statusCode
                });

                if (shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
                    this.reconnectAttempts++;
                    console.log(`[WA] Reconnecting... attempt ${this.reconnectAttempts}`);
                    setTimeout(() => this.initialize(), 5000);
                } else if (statusCode === DisconnectReason.loggedOut) {
                    console.log('[WA] Logged out, clearing session');
                    await this.clearSession();
                    await db.User.update(
                        { whatsappConnected: false, whatsappNumber: null },
                        { where: { id: this.userId } }
                    );
                }
            }

            // Connection opened
            if (connection === 'open') {
                console.log('[WA] Connection opened successfully!');
                
                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.qrRetryCount = 0;
                this.qrCode = null;

                const phoneNumber = this.socket.user?.id?.split(':')[0];
                console.log(`[WA] Connected as: ${phoneNumber}`);
                
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
                    const statusMap = { 2: 'sent', 3: 'delivered', 4: 'read' };
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
    }

    async sendMessage(phone, message, options = {}) {
        if (!this.isConnected) {
            throw new Error('WhatsApp not connected');
        }

        const jid = this.formatPhoneNumber(phone);
        console.log(`[WA] Sending message to: ${jid}`);

        try {
            // Check if number exists
            const [result] = await this.socket.onWhatsApp(jid.replace('@s.whatsapp.net', ''));
            
            if (!result?.exists) {
                throw new Error('Number not registered on WhatsApp');
            }

            let sentMessage;

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
                    default:
                        sentMessage = await this.socket.sendMessage(jid, { text: message });
                }
            } else {
                sentMessage = await this.socket.sendMessage(jid, { text: message });
            }

            console.log(`[WA] Message sent successfully: ${sentMessage.key.id}`);

            return {
                success: true,
                messageId: sentMessage.key.id,
                timestamp: new Date()
            };
        } catch (error) {
            console.error(`[WA] Send message error:`, error);
            throw error;
        }
    }

    async sendBulkMessages(messages, settings = {}) {
        const results = [];
        const minDelay = settings.minDelay || 3000;
        const maxDelay = settings.maxDelay || 8000;

        console.log(`[WA] Starting bulk send: ${messages.length} messages`);

        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];

            try {
                let processedMessage = msg.message;
                
                if (settings.useSpintax) {
                    processedMessage = this.processSpintax(processedMessage);
                }
                
                processedMessage = this.replaceVariables(processedMessage, msg.variables || {});

                const result = await this.sendMessage(msg.phone, processedMessage, {
                    mediaType: msg.mediaType,
                    mediaUrl: msg.mediaUrl
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
                console.error(`[WA] Failed to send to ${msg.phone}:`, error.message);
                
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

            // Random delay
            const randomDelay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
            await this.delay(randomDelay);
        }

        console.log(`[WA] Bulk send completed. Success: ${results.filter(r => r.success).length}, Failed: ${results.filter(r => !r.success).length}`);

        return results;
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    processSpintax(text) {
        return text.replace(/\{([^{}]+)\}/g, (match, group) => {
            const options = group.split('|');
            return options[Math.floor(Math.random() * options.length)];
        });
    }

    replaceVariables(text, variables) {
        let result = text;
        for (const [key, value] of Object.entries(variables)) {
            result = result.replace(new RegExp(`{{${key}}}`, 'gi'), value || '');
        }
        return result;
    }

    formatPhoneNumber(phone) {
        let cleaned = phone.replace(/\D/g, '');
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

    async getStatus() {
        return {
            connected: this.isConnected,
            phone: this.socket?.user?.id?.split(':')[0] || null,
            qrCode: this.qrCode
        };
    }

    async logout() {
        try {
            if (this.socket) {
                await this.socket.logout();
            }
        } catch (e) {
            console.error('[WA] Logout error:', e);
        }
        await this.clearSession();
    }

    async clearSession() {
        const sessionPath = path.join(__dirname, '..', 'sessions', this.userId);
        try {
            if (fs.existsSync(sessionPath)) {
                fs.rmSync(sessionPath, { recursive: true, force: true });
            }
        } catch (e) {
            console.error('[WA] Clear session error:', e);
        }
        global.whatsappInstances.delete(this.userId);
    }

    emitToUser(event, data) {
        console.log(`[WA] Emitting event: ${event}`, data);
        if (global.io) {
            global.io.to(`user-${this.userId}`).emit(event, data);
        } else {
            console.error('[WA] Socket.io not initialized!');
        }
    }
}

module.exports = WhatsAppService;
