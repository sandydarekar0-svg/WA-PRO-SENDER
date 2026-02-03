module.exports = (sequelize, DataTypes) => {
    const User = sequelize.define('User', {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true
        },
        name: {
            type: DataTypes.STRING,
            allowNull: false
        },
        email: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true
        },
        password: {
            type: DataTypes.STRING,
            allowNull: false
        },
        role: {
            type: DataTypes.ENUM('admin', 'user', 'reseller'),
            defaultValue: 'user'
        },
        plan: {
            type: DataTypes.ENUM('free', 'basic', 'pro', 'enterprise'),
            defaultValue: 'free'
        },
        dailyLimit: {
            type: DataTypes.INTEGER,
            defaultValue: 100
        },
        monthlyLimit: {
            type: DataTypes.INTEGER,
            defaultValue: 3000
        },
        messagesUsedToday: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        messagesUsedMonth: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        whatsappConnected: {
            type: DataTypes.BOOLEAN,
            defaultValue: false
        },
        whatsappNumber: {
            type: DataTypes.STRING,
            allowNull: true
        },
        isActive: {
            type: DataTypes.BOOLEAN,
            defaultValue: true
        },
        lastLogin: {
            type: DataTypes.DATE,
            allowNull: true
        },
        settings: {
            type: DataTypes.JSON,
            defaultValue: {
                minDelay: 3000,
                maxDelay: 8000,
                batchSize: 50,
                timezone: 'UTC'
            }
        }
    }, {
        timestamps: true
    });

    return User;
};
