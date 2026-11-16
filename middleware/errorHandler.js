const errorHandler = (err, req, res, next) => {
    let error = { ...err };
    error.message = err.message;

    // Log error for debugging
    console.error('❌ Error:', err);

    if (err.code === 'P2002') {
        const field = Array.isArray(err.meta?.target) ? err.meta.target[0] : 'Resource';
        error = { message: `${field} already exists`, statusCode: 400 };
    }
    if (err.code === 'P2025') error = { message: 'Resource not found', statusCode: 404 };
    if (err.code === 'P2003') error = { message: 'Related resource does not exist', statusCode: 400 };
    if (err.name === 'PrismaClientValidationError') error = { message: err.message, statusCode: 400 };

    // JWT errors
    if (err.name === 'JsonWebTokenError') {
        error = { message: 'Invalid token', statusCode: 401 };
    }

    if (err.name === 'TokenExpiredError') {
        error = { message: 'Token expired', statusCode: 401 };
    }

    res.status(error.statusCode || 500).json({
        success: false,
        message: error.message || 'Server Error',
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
};

const notFound = (req, res, next) => {
    res.status(404).json({
        success: false,
        message: `Cannot ${req.method} ${req.url}`
    });
};

module.exports = { errorHandler, notFound };