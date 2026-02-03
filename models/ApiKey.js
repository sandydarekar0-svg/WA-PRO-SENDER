module.exports = (sequelize, DataTypes) => {
    const ApiKey = sequelize.define('ApiKey', {
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
        key: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true
        },
        secret: {
            type: DataTypes.STRING,
            allowNull: false
        },
        permissions: {
            type: DataTypes.JSON,
            defaultValue: ['send_message', 'get_status']
        },
        rateLimit: {
            type: DataTypes.INTEGER,
            defaultValue: 100
        },
        rateLimitWindow: {
            type: DataTypes.INTEGER,
            defaultValue: 60000
        },
        requestCount: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        lastUsed: {
            type: DataTypes.DATE,
            allowNull: true
        },
        expiresAt: {
            type: DataTypes.DATE,
            allowNull: true
        },
        isActive: {
            type: DataTypes.BOOLEAN,
            defaultValue: true
        },
        allowedIps: {
            type: DataTypes.JSON,
            defaultValue: []
        },
        webhookUrl: {
            type: DataTypes.STRING,
            allowNull: true
        }
    }, {
        timestamps: true
    });

    return ApiKey;
};
