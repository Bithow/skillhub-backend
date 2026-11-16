const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { isFreelancer } = require('../middleware/roleCheck');
const { validate, freelancerValidation } = require('../middleware/validation');
const {
    createFreelancerProfile,
    getFreelancers,
    getFreelancerById,
    updateFreelancerProfile,
    getMyFreelancerProfile,
    getMyHireRequests,
    createHireRequest,
    contactFreelancer
} = require('../controllers/freelancerController');
const {
    createFreelanceProject,
    getMyFreelanceProjects,
    updateFreelanceProjectStatus,
    createFreelancePaymentReport,
    respondToFreelancePaymentReport,
    getProjectPaymentReports
} = require('../controllers/financeController');

router.route('/')
    .get(getFreelancers)
    .post(protect, freelancerValidation.create, validate, createFreelancerProfile);

router.get('/me', protect, getMyFreelancerProfile);
router.put('/me', protect, updateFreelancerProfile);
router.get('/hire-requests', protect, getMyHireRequests);
router.post('/:id/hire-requests', protect, createHireRequest);
router.get('/projects', protect, getMyFreelanceProjects);
router.post('/projects', protect, createFreelanceProject);
router.patch('/projects/:id', protect, updateFreelanceProjectStatus);
router.get('/projects/:id/payment-reports', protect, getProjectPaymentReports);
router.post('/projects/:id/payment-reports', protect, createFreelancePaymentReport);
router.put('/projects/:id/payment-reports/:reportId/client-response', protect, respondToFreelancePaymentReport);
router.get('/:id', getFreelancerById);
router.post('/:id/contact', protect, contactFreelancer);

module.exports = router;