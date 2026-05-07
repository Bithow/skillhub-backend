const roleCheck = (...roles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: 'Not authenticated'
            });
        }

        if (!roles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: `Access denied. ${roles.join(' or ')} role required.`
            });
        }

        next();
    };
};

const isAdmin = roleCheck('admin');
const isInstructor = roleCheck('admin', 'instructor');
const isFreelancer = roleCheck('admin', 'freelancer');
const isAdminOrInstructor = roleCheck('admin', 'instructor');
const isAdminOrFreelancer = roleCheck('admin', 'freelancer');

module.exports = {
    roleCheck,
    isAdmin,
    isInstructor,
    isFreelancer,
    isAdminOrInstructor,
    isAdminOrFreelancer
};