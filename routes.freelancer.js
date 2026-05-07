const express = require('express');
const router = express.Router();
const { protect, isFreelancer } = require('../middleware/roleCheck');
const { validate, freelancerValidation } = require('../middleware/validation');
const {
    createFreelancerProfile,
    getFreelancers,
    getFreelancerById,
    updateFreelancerProfile,
    getMyFreelancerProfile,
    contactFreelancer
} = require('../controllers/freelancerController');

router.route('/')
    .get(getFreelancers)
    .post(protect, freelancerValidation.create, validate, createFreelancerProfile);

router.get('/me', protect, getMyFreelancerProfile);
router.put('/me', protect, updateFreelancerProfile);
router.get('/:id', getFreelancerById);
router.post('/:id/contact', protect, contactFreelancer);

module.exports = router;