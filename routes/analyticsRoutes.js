const express = require('express');
const { recordSiteVisit } = require('../controllers/analyticsController');

const router = express.Router();
router.post('/visit', recordSiteVisit);

module.exports = router;