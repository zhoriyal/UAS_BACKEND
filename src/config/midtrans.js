const midtransClient = require('midtrans-client');

const isProduction = process.env.MIDTRANS_IS_PRODUCTION === 'true';
const serverKey = process.env.MIDTRANS_SERVER_KEY?.trim() || '';
const clientKey = process.env.MIDTRANS_CLIENT_KEY?.trim() || '';
const serverKeyPrefix = isProduction ? 'Mid-server-' : 'SB-Mid-server-';
const clientKeyPrefix = isProduction ? 'Mid-client-' : 'SB-Mid-client-';
if (!serverKey.startsWith(serverKeyPrefix) || !clientKey.startsWith(clientKeyPrefix)) {
    throw new Error('MIDTRANS_SERVER_KEY dan MIDTRANS_CLIENT_KEY harus sesuai dengan MIDTRANS_IS_PRODUCTION');
}

const snap = new midtransClient.Snap({
    isProduction,
    serverKey,
    clientKey,
});

module.exports = snap;