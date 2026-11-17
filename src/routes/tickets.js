const express = require('express');
const { checkout, getTicketPdf } = require('../controllers/ticketPaymentController');

const router = express.Router();

router.post('/checkout', checkout);
router.get('/files/:filename', getTicketPdf);

module.exports = router;
