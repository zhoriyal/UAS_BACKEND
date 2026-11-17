const express = require('express');
const { checkout, handleWebhook, getTicketPdf } = require('../controllers/ticketPaymentController');

const router = express.Router();

// 1. Endpoint untuk membuat transaksi pembayaran Midtrans (QRIS / Virtual Account) dari Flutter
router.post('/checkout', checkout);

// 2. Endpoint webhook yang dipanggil otomatis oleh Midtrans setelah user bayar
router.post('/webhook', handleWebhook);

// 3. Endpoint untuk mengunduh file PDF e-tiket setelah lunas
router.get('/files/:filename', getTicketPdf);

module.exports = router;