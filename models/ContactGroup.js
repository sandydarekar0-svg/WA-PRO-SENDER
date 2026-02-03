module.exports = (sequelize, DataTypes) => {
    const ContactGroup = sequelize.define('ContactGroup', {
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
        description: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        color: {
            type: DataTypes.STRING,
            defaultValue: '#3498db'
        },
        contactCount: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        }
    }, {
        timestamps: true
    });

    return ContactGroup;
};
