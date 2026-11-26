import { Router } from 'express';
import {
  checkTransactionStatus,
  createTransaction,
  downloadTicketPdf,
  getQrisImage,
  getTicketQrImage,
  handleNotification,
  renderQrisCheckoutPage,
  serveCheckoutScript,
} from '../controllers/paymentController';
import { asyncHandler } from '../database';

const router = Router();

router.post('/create', asyncHandler(createTransaction));
router.post('/create-transaction', asyncHandler(createTransaction));
router.post('/status', asyncHandler(checkTransactionStatus));
router.get('/status/:bookingId', asyncHandler(checkTransactionStatus));
router.post('/notification', asyncHandler(handleNotification));
router.get('/checkout-script.js', serveCheckoutScript);
router.get('/checkout/:bookingId', asyncHandler(renderQrisCheckoutPage));
router.get('/qris-image/:bookingId', asyncHandler(getQrisImage));
router.get('/ticket-qr/:bookingId', asyncHandler(getTicketQrImage));
router.get('/ticket-pdf/:bookingId', asyncHandler(downloadTicketPdf));

export default router;
