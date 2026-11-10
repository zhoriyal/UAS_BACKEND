const express = require('express');
const { createTransaction, handleNotification } = require('../controllers/paymentController');

const router = express.Router();

router.post('/create', createTransaction);
router.post('/create-transaction', createTransaction);
router.post('/notification', handleNotification);

module.exports = router;