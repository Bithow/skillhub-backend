const prisma = require('../utils/prisma');

const permissionCheck = permission => async (req, res, next) => {
    try {
        const admin = await prisma.user.findUnique({
            where: { id: req.user.id },
            select: { adminRole: true, adminPermissions: true }
        });
        const permissions = Array.isArray(admin?.adminPermissions) ? admin.adminPermissions : [];
        if (admin?.adminRole === 'super_admin' || permissions.includes('all') || permissions.includes(permission)) {
            return next();
        }
        return res.status(403).json({ success: false, message: `Missing required permission: ${permission}` });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Could not verify admin permissions' });
    }
};

module.exports = { permissionCheck };