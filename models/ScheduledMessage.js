module.exports = (sequelize, DataTypes) => {
    const ScheduledMessage = sequelize.define('ScheduledMessage', {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true
        },
        userId: {
            type: DataTypes.UUID,
            allowNull: false
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
        scheduledAt: {
            type: DataTypes.DATE,
            allowNull: false
        },
        timezone: {
            type: DataTypes.STRING,
            defaultValue: 'UTC'
        },
        status: {
            type: DataTypes.ENUM('pending', 'sent', 'failed', 'cancelled'),
            defaultValue: 'pending'
        },
        recurring: {
            type: DataTypes.BOOLEAN,
            defaultValue: false
        },
        recurringPattern: {
            type: DataTypes.JSON,
            allowNull: true
        }
    }, {
        timestamps: true
    });

    return ScheduledMessage;
};
