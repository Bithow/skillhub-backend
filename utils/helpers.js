const crypto = require('crypto');

// Generate unique reference number
const generateReference = (prefix = 'TXN') => {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
};

// Calculate commission (20% platform fee)
const calculateCommission = (amount, rate = 0.20) => {
    const commission = amount * rate;
    const netAmount = amount - commission;
    return { commission, netAmount };
};

// Format USD consistently across the platform.
const formatUSD = (amount) => {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(amount);
};

// Validate Ethiopian phone number
const validateEthiopianPhone = (phone) => {
    const clean = phone.toString().replace(/\D/g, '');
    return /^(251|09|07)\d{8,9}$/.test(clean);
};

// Format phone number for WhatsApp
const formatPhoneForWhatsApp = (phone) => {
    let clean = phone.toString().replace(/\D/g, '');
    if (clean.length === 10 && clean.startsWith('09')) {
        clean = '251' + clean.substring(1);
    }
    return clean;
};

// Calculate average rating
const calculateAverageRating = (reviews) => {
    if (!reviews || reviews.length === 0) return 0;
    const sum = reviews.reduce((acc, review) => acc + review.rating, 0);
    return sum / reviews.length;
};

// Pagination helper
const getPagination = (page, limit, total) => {
    const currentPage = parseInt(page) || 1;
    const perPage = parseInt(limit) || 20;
    const totalPages = Math.ceil(total / perPage);
    const skip = (currentPage - 1) * perPage;
    
    return {
        currentPage,
        perPage,
        totalPages,
        skip,
        hasNext: currentPage < totalPages,
        hasPrev: currentPage > 1
    };
};

// Generate slug from title
const generateSlug = (text) => {
    return text
        .toString()
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^\w\-]+/g, '')
        .replace(/\-\-+/g, '-');
};

// Mask sensitive data
const maskEmail = (email) => {
    const [name, domain] = email.split('@');
    return name.substring(0, 2) + '***@' + domain;
};

const maskPhone = (phone) => {
    const clean = phone.toString().replace(/\D/g, '');
    if (clean.length <= 6) return '***';
    return clean.substring(0, 3) + '****' + clean.slice(-3);
};

// Delay function (for rate limiting)
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

module.exports = {
    generateReference,
    calculateCommission,
    formatUSD,
    validateEthiopianPhone,
    formatPhoneForWhatsApp,
    calculateAverageRating,
    getPagination,
    generateSlug,
    maskEmail,
    maskPhone,
    delay
};