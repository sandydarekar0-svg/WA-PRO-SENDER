module.exports = (sequelize, DataTypes) => {
    const Campaign = sequelize.define('Campaign', {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true
        },
        userId: {
            type: DataTypes.UUID,
            allowNull: false
        },
        templateId: {
            type: DataTypes.UUID,
            allowNull: true
        },
        name: {
            type: DataTypes.STRING,
            allowNull: false
        },
        status: {
            type: DataTypes.ENUM('draft', 'scheduled', 'running', 'paused', 'completed', 'failed'),
            defaultValue: 'draft'
        },
        type: {
            type: DataTypes.ENUM('instant', 'scheduled', 'recurring'),
            defaultValue: 'instant'
        },
        message: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        mediaType: {
            type: DataTypes.ENUM('none', 'image', 'video', 'document', 'audio'),
            defaultValue: 'none'
        },
        mediaUrl: {
            type: DataTypes.STRING,
            allowNull: true
        },
        targetGroups: {
            type: DataTypes.JSON,
            defaultValue: []
        },
        targetContacts: {
            type: DataTypes.JSON,
            defaultValue: []
        },
        totalContacts: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        sentCount: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        deliveredCount: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        failedCount: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        scheduledAt: {
            type: DataTypes.DATE,
            allowNull: true
        },
        startedAt: {
            type: DataTypes.DATE,
            allowNull: true
        },
        completedAt: {
            type: DataTypes.DATE,
            allowNull: true
        },
        settings: {
            type: DataTypes.JSON,
            defaultValue: {
                minDelay: 3000,
                maxDelay: 8000,
                batchSize: 50
            }
        },
        recurringPattern: {
            type: DataTypes.JSON,
            allowNull: true
        }
    }, {
        timestamps: true
    });

    return Campaign;
};
