import { Router } from 'express';
import { checkout, handleWebhook, getTicketPdf } from '../controllers/ticketPaymentController';
import {
  checkTransactionStatus,
  createTransaction,
  downloadTicketPdf,
  getQrisImage,
  getTicketQrImage,
  renderQrisCheckoutPage,
  serveCheckoutScript,
} from '../controllers/paymentController';
import { asyncHandler } from '../database';

const router = Router();

router.post('/checkout', asyncHandler(checkout));
router.post('/webhook', asyncHandler(handleWebhook));
router.get('/files/:filename', asyncHandler(getTicketPdf));

// Alias route transaksi Snap & QRIS Midtrans agar kompatibel dengan /api/payment maupun /api/payments
router.post('/create-transaction', asyncHandler(createTransaction));
router.post('/create', asyncHandler(createTransaction));
router.post('/status', asyncHandler(checkTransactionStatus));
router.get('/status/:bookingId', asyncHandler(checkTransactionStatus));
router.get('/checkout-script.js', serveCheckoutScript);
router.get('/checkout/:bookingId', asyncHandler(renderQrisCheckoutPage));
router.get('/qris-image/:bookingId', asyncHandler(getQrisImage));
router.get('/ticket-qr/:bookingId', asyncHandler(getTicketQrImage));
router.get('/ticket-pdf/:bookingId', asyncHandler(downloadTicketPdf));

export default router;
