module.exports = (sequelize, DataTypes) => {
    const Webhook = sequelize.define('Webhook', {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true
        },
        userId: {
            type: DataTypes.UUID,
            allowNull: false
        },
        name: {
            type: DataTypes.STRING,
            allowNull: false
        },
        url: {
            type: DataTypes.STRING,
            allowNull: false
        },
        events: {
            type: DataTypes.JSON,
            defaultValue: ['message.sent', 'message.delivered', 'message.failed']
        },
        secret: {
            type: DataTypes.STRING,
            allowNull: true
        },
        isActive: {
            type: DataTypes.BOOLEAN,
            defaultValue: true
        },
        lastTriggered: {
            type: DataTypes.DATE,
            allowNull: true
        },
        failureCount: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        }
    }, {
        timestamps: true
    });

    return Webhook;
};
