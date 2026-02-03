module.exports = (sequelize, DataTypes) => {
    const Contact = sequelize.define('Contact', {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true
        },
        userId: {
            type: DataTypes.UUID,
            allowNull: false
        },
        groupId: {
            type: DataTypes.UUID,
            allowNull: true
        },
        phone: {
            type: DataTypes.STRING,
            allowNull: false
        },
        name: {
            type: DataTypes.STRING,
            allowNull: true
        },
        email: {
            type: DataTypes.STRING,
            allowNull: true
        },
        variables: {
            type: DataTypes.JSON,
            defaultValue: {}
        },
        tags: {
            type: DataTypes.JSON,
            defaultValue: []
        },
        isValid: {
            type: DataTypes.BOOLEAN,
            defaultValue: true
        },
        isBlocked: {
            type: DataTypes.BOOLEAN,
            defaultValue: false
        },
        lastContacted: {
            type: DataTypes.DATE,
            allowNull: true
        },
        messageCount: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        }
    }, {
        timestamps: true,
        indexes: [
            { fields: ['phone'] },
            { fields: ['userId', 'phone'], unique: true }
        ]
    });

    return Contact;
};
