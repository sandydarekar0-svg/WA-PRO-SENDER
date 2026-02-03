const { 
    default: makeWASocket, 
    DisconnectReason, 
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    Browsers
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const db = require('../config/database');

class WhatsAppService {
    constructor(userId) {
        this.userId = userId;
        this.socket = null;
        this.qrCode = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.connectionTimeout = null;
    }

    log(message, type = 'info') {
        const prefix = `[WA:${this.userId.substring(0, 8)}]`;
        const timestamp = new Date().toISOString();
        console.log(`${timestamp} ${prefix} [${type.toUpperCase()}] ${message}`);
    }

    async initialize() {
        try {
            // Clear any existing timeout
            if (this.connectionTimeout) {
                clearTimeout(this.connectionTimeout);
            }

            const sessionPath = path.join(process.cwd(), 'sessions', this.userId);
            
            // Create sessions directory
            if (!fs.existsSync(sessionPath)) {
                fs.mkdirSync(sessionPath, { recursive: true });
                this.log(`Created session directory: ${sessionPath}`);
            }

            this.log('Initializing WhatsApp connection...');
            this.log(`Session path: ${sessionPath}`);

            // Get auth state
            const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
            this.log('Auth state loaded');

            // Get latest version
            const { version, isLatest } = await fetchLatestBaileysVersion();
            this.log(`WhatsApp version: ${version.join('.')} (Latest: ${isLatest})`);

            // Create socket
            this.socket = makeWASocket({
                version,
                logger: pino({ level: 'silent' }),
                printQRInTerminal: true,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
                },
                browser: Browsers.ubuntu('Chrome'),
                connectTimeoutMs: 60000,
                qrTimeout: 60000,
                defaultQueryTimeoutMs: 60000,
                markOnlineOnConnect: false,
                syncFullHistory: false,
                generateHighQualityLinkPreview: false
            });

            this.log('Socket created, setting up event handlers...');
            this.setupEventHandlers(saveCreds);

            // Set connection timeout
            this.connectionTimeout = setTimeout(() => {
                if (!this.isConnected && this.qrCode) {
                    this.log('Connection timeout - QR not scanned', 'warn');
                    this.emitToUser('connection-timeout', {
                        message: 'QR Code expired. Please try again.'
                    });
                }
            }, 120000); // 2 minutes timeout

            return this;
        } catch (error) {
            this.log(`Initialize error: ${error.message}`, 'error');
            console.error(error);
            throw error;
        }
    }

    setupEventHandlers(saveCreds) {
        if (!this.socket) {
            this.log('Socket is null, cannot setup handlers', 'error');
            return;
        }

        // Connection Update Handler
        this.socket.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            this.log(`Connection update: ${JSON.stringify({ connection, hasQR: !!qr })}`);

            // Handle QR Code
            if (qr) {
                this.log('QR Code received, generating image...');
                
                try {
                    // Print to terminal
                    qrcodeTerminal.generate(qr, { small: true });
                    
                    // Generate base64 image
                    this.qrCode = await qrcode.toDataURL(qr, {
                        width: 300,
                        margin: 2,
                        color: {
                            dark: '#000000',
                            light: '#FFFFFF'
                        }
                    });
                    
                    this.log('QR Code generated successfully');
                    this.log(`QR Code length: ${this.qrCode.length} chars`);
                    
                    // Emit to frontend
                    this.emitToUser('qr-code', { 
                        qr: this.qrCode,
                        timestamp: Date.now()
                    });
                    
                    this.log('QR Code emitted to user');
                } catch (err) {
                    this.log(`QR generation error: ${err.message}`, 'error');
                }
            }

            // Handle Connection Close
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const reason = DisconnectReason[statusCode] || statusCode;
                
                this.log(`Connection closed. Reason: ${reason} (${statusCode})`, 'warn');
                
                this.isConnected = false;
                this.qrCode = null;

                this.emitToUser('connection-status', {
                    status: 'disconnected',
                    reason: reason,
                    code: statusCode
                });

                // Handle reconnection
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut && 
                                       statusCode !== 401;

                if (shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
                    this.reconnectAttempts++;
                    this.log(`Attempting reconnect ${this.reconnectAttempts}/${this.maxReconnectAttempts}...`);
                    
                    setTimeout(() => {
                        this.initialize().catch(err => {
                            this.log(`Reconnect failed: ${err.message}`, 'error');
                        });
                    }, 3000);
                } else if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                    this.log('Logged out, clearing session...');
                    await this.clearSession();
                    
                    await db.User.update(
                        { whatsappConnected: false, whatsappNumber: null },
                        { where: { id: this.userId } }
                    );
                }
            }

            // Handle Connection Open
            if (connection === 'open') {
                this.log('Connection opened successfully!', 'success');
                
                // Clear timeout
                if (this.connectionTimeout) {
                    clearTimeout(this.connectionTimeout);
                    this.connectionTimeout = null;
                }
                
                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.qrCode = null;

                // Get phone number
                const phoneNumber = this.socket.user?.id?.split(':')[0] || 
                                   this.socket.user?.id?.split('@')[0];
                
                this.log(`Connected as: ${phoneNumber}`);

                // Update database
                await db.User.update(
                    { whatsappConnected: true, whatsappNumber: phoneNumber },
                    { where: { id: this.userId } }
                );

                // Emit to frontend
                this.emitToUser('connection-status', {
                    status: 'connected',
                    phone: phoneNumber
                });
            }
        });

        // Credentials Update Handler
        this.socket.ev.on('creds.update', async () => {
            this.log('Credentials updated, saving...');
            await saveCreds();
        });

        // Messages Update Handler (for delivery status)
        this.socket.ev.on('messages.update', async (updates) => {
            for (const update of updates) {
                if (update.update.status) {
                    const statusMap = {
                        1: 'pending',
                        2: 'sent',
                        3: 'delivered',
                        4: 'read'
                    };
                    
                    const status = statusMap[update.update.status];
                    
                    if (status && update.key.id) {
                        this.log(`Message ${update.key.id} status: ${status}`);
                        
                        try {
                            await db.Message.update(
                                { 
                                    status,
                                    ...(status === 'delivered' && { deliveredAt: new Date() }),
                                    ...(status === 'read' && { readAt: new Date() })
                                },
                                { where: { whatsappMessageId: update.key.id } }
                            );
                        } catch (err) {
                            this.log(`Status update error: ${err.message}`, 'error');
                        }

                        this.emitToUser('message-status', {
                            messageId: update.key.id,
                            status
                        });
                    }
                }
            }
        });

        this.log('Event handlers setup complete');
    }

    async sendMessage(phone, message, options = {}) {
        if (!this.isConnected || !this.socket) {
            throw new Error('WhatsApp not connected');
        }

        // Format phone number
        let jid = phone.replace(/\D/g, '');
        if (!jid.includes('@')) {
            jid = `${jid}@s.whatsapp.net`;
        }

        this.log(`Sending message to: ${jid}`);

        try {
            // Check if number exists on WhatsApp
            const [exists] = await this.socket.onWhatsApp(jid.replace('@s.whatsapp.net', ''));
            
            if (!exists?.exists) {
                throw new Error(`Number ${phone} is not on WhatsApp`);
            }

            let sentMessage;

            // Send based on media type
            if (options.mediaType && options.mediaUrl) {
                const mediaMessage = {
                    caption: message
                };

                switch (options.mediaType) {
                    case 'image':
                        mediaMessage.image = { url: options.mediaUrl };
                        break;
                    case 'video':
                        mediaMessage.video = { url: options.mediaUrl };
                        break;
                    case 'document':
                        mediaMessage.document = { url: options.mediaUrl };
                        mediaMessage.fileName = options.fileName || 'document';
                        mediaMessage.mimetype = options.mimetype || 'application/pdf';
                        break;
                    case 'audio':
                        mediaMessage.audio = { url: options.mediaUrl };
                        mediaMessage.ptt = options.ptt || false;
                        delete mediaMessage.caption;
                        break;
                    default:
                        sentMessage = await this.socket.sendMessage(jid, { text: message });
                }

                if (!sentMessage) {
                    sentMessage = await this.socket.sendMessage(jid, mediaMessage);
                }
            } else {
                // Text only message
                sentMessage = await this.socket.sendMessage(jid, { text: message });
            }

            this.log(`Message sent: ${sentMessage.key.id}`);

            return {
                success: true,
                messageId: sentMessage.key.id,
                timestamp: new Date()
            };

        } catch (error) {
            this.log(`Send error: ${error.message}`, 'error');
            throw error;
        }
    }

    async sendBulkMessages(messages, settings = {}) {
        const results = [];
        const minDelay = settings.minDelay || 3000;
        const maxDelay = settings.maxDelay || 8000;
        const batchSize = settings.batchSize || 50;
        const batchDelay = settings.batchDelay || 60000;

        this.log(`Starting bulk send: ${messages.length} messages`);
        this.log(`Settings: minDelay=${minDelay}, maxDelay=${maxDelay}, batchSize=${batchSize}`);

        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];
            
            try {
                // Process message
                let processedMessage = msg.message;
                
                // Apply spintax
                if (settings.useSpintax) {
                    processedMessage = this.processSpintax(processedMessage);
                }
                
                // Replace variables
                processedMessage = this.replaceVariables(processedMessage, msg.variables || {});

                // Send message
                const result = await this.sendMessage(msg.phone, processedMessage, {
                    mediaType: msg.mediaType,
                    mediaUrl: msg.mediaUrl
                });

                results.push({
                    phone: msg.phone,
                    success: true,
                    messageId: result.messageId
                });

                // Emit progress
                const progress = ((i + 1) / messages.length * 100).toFixed(1);
                this.emitToUser('message-sent', {
                    phone: msg.phone,
                    success: true,
                    progress,
                    current: i + 1,
                    total: messages.length
                });

                this.log(`Sent ${i + 1}/${messages.length} to ${msg.phone}`);

            } catch (error) {
                this.log(`Failed ${msg.phone}: ${error.message}`, 'error');
                
                results.push({
                    phone: msg.phone,
                    success: false,
                    error: error.message
                });

                this.emitToUser('message-failed', {
                    phone: msg.phone,
                    error: error.message,
                    current: i + 1,
                    total: messages.length
                });
            }

            // Random delay between messages
            if (i < messages.length - 1) {
                const delay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
                this.log(`Waiting ${delay}ms before next message...`);
                await this.sleep(delay);
            }

            // Batch pause
            if ((i + 1) % batchSize === 0 && i < messages.length - 1) {
                this.log(`Batch complete, pausing for ${batchDelay}ms...`);
                this.emitToUser('batch-pause', {
                    message: `Completed ${i + 1} messages. Pausing for ${batchDelay / 1000}s...`,
                    batchNumber: Math.floor((i + 1) / batchSize)
                });
                await this.sleep(batchDelay);
            }
        }

        const successCount = results.filter(r => r.success).length;
        const failCount = results.filter(r => !r.success).length;
        
        this.log(`Bulk send complete: ${successCount} sent, ${failCount} failed`);

        this.emitToUser('bulk-complete', {
            total: messages.length,
            sent: successCount,
            failed: failCount
        });

        return results;
    }

    processSpintax(text) {
        return text.replace(/\{([^{}]+)\}/g, (match, group) => {
            const options = group.split('|');
            return options[Math.floor(Math.random() * options.length)].trim();
        });
    }

    replaceVariables(text, variables) {
        let result = text;
        for (const [key, value] of Object.entries(variables)) {
            const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'gi');
            result = result.replace(regex, value || '');
        }
        return result;
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async checkNumber(phone) {
        if (!this.isConnected || !this.socket) {
            throw new Error('WhatsApp not connected');
        }

        const jid = phone.replace(/\D/g, '');
        const [result] = await this.socket.onWhatsApp(jid);
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
        this.log('Logging out...');
        
        if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
        }
        
        try {
            if (this.socket) {
                await this.socket.logout();
            }
        } catch (error) {
            this.log(`Logout error: ${error.message}`, 'error');
        }
        
        await this.clearSession();
    }

    async clearSession() {
        this.log('Clearing session...');
        
        const sessionPath = path.join(process.cwd(), 'sessions', this.userId);
        
        try {
            if (fs.existsSync(sessionPath)) {
                fs.rmSync(sessionPath, { recursive: true, force: true });
                this.log('Session cleared');
            }
        } catch (error) {
            this.log(`Clear session error: ${error.message}`, 'error');
        }
        
        this.socket = null;
        this.qrCode = null;
        this.isConnected = false;
        
        global.whatsappInstances.delete(this.userId);
    }

    emitToUser(event, data) {
        if (global.io) {
            this.log(`Emitting ${event} to user-${this.userId}`);
            global.io.to(`user-${this.userId}`).emit(event, data);
        } else {
            this.log('Socket.io not available!', 'error');
        }
    }
}

module.exports = WhatsAppService;
