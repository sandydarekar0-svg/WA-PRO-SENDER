module.exports = (sequelize, DataTypes) => {
    const Template = sequelize.define('Template', {
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
        category: {
            type: DataTypes.STRING,
            defaultValue: 'general'
        },
        content: {
            type: DataTypes.TEXT,
            allowNull: false
        },
        variables: {
            type: DataTypes.JSON,
            defaultValue: []
        },
        mediaType: {
            type: DataTypes.ENUM('none', 'image', 'video', 'document', 'audio'),
            defaultValue: 'none'
        },
        mediaUrl: {
            type: DataTypes.STRING,
            allowNull: true
        },
        buttons: {
            type: DataTypes.JSON,
            defaultValue: []
        },
        footer: {
            type: DataTypes.STRING,
            allowNull: true
        },
        useSpintax: {
            type: DataTypes.BOOLEAN,
            defaultValue: false
        },
        isActive: {
            type: DataTypes.BOOLEAN,
            defaultValue: true
        },
        usageCount: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        }
    }, {
        timestamps: true
    });

    return Template;
};
