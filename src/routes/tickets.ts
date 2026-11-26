import { Router } from 'express';
import { checkout, getTicketPdf } from '../controllers/ticketPaymentController';
import { asyncHandler } from '../database';

const router = Router();

router.post('/checkout', asyncHandler(checkout));
router.get('/files/:filename', asyncHandler(getTicketPdf));

export default router;
