module.exports = (sequelize, DataTypes) => {
    const Message = sequelize.define('Message', {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true
        },
        userId: {
            type: DataTypes.UUID,
            allowNull: false
        },
        campaignId: {
            type: DataTypes.UUID,
            allowNull: true
        },
        phone: {
            type: DataTypes.STRING,
            allowNull: false
        },
        message: {
            type: DataTypes.TEXT,
            allowNull: false
        },
        mediaType: {
            type: DataTypes.STRING,
            allowNull: true
        },
        mediaUrl: {
            type: DataTypes.STRING,
            allowNull: true
        },
        status: {
            type: DataTypes.ENUM('pending', 'sent', 'delivered', 'read', 'failed'),
            defaultValue: 'pending'
        },
        whatsappMessageId: {
            type: DataTypes.STRING,
            allowNull: true
        },
        errorMessage: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        sentAt: {
            type: DataTypes.DATE,
            allowNull: true
        },
        deliveredAt: {
            type: DataTypes.DATE,
            allowNull: true
        },
        readAt: {
            type: DataTypes.DATE,
            allowNull: true
        },
        source: {
            type: DataTypes.ENUM('campaign', 'api', 'manual'),
            defaultValue: 'manual'
        }
    }, {
        timestamps: true,
        indexes: [
            { fields: ['status'] },
            { fields: ['campaignId'] },
            { fields: ['userId', 'createdAt'] }
        ]
    });

    return Message;
};
