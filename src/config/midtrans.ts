import midtransClient from 'midtrans-client';

const isProduction = process.env.MIDTRANS_IS_PRODUCTION === 'true';
const serverKey = process.env.MIDTRANS_SERVER_KEY?.trim() || '';
const expectedServerKeyPrefix = isProduction ? 'Mid-server-' : 'SB-Mid-server-';
if (!serverKey.startsWith(expectedServerKeyPrefix)) {
  throw new Error('MIDTRANS_SERVER_KEY harus sesuai dengan MIDTRANS_IS_PRODUCTION');
}

export const snap = new (midtransClient as any).Snap({
  isProduction,
  serverKey,
});

export default snap;
