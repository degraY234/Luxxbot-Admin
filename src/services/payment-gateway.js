import axios from 'axios';

const MIDTRANS_SERVER_KEY = process.env.MIDTRANS_SERVER_KEY || '';
const MIDTRANS_CLIENT_KEY = process.env.MIDTRANS_CLIENT_KEY || '';
const MIDTRANS_BASE_URL = 'https://api.midtrans.com';

function getMidtransHeaders() {
    return {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': 'Basic ' + Buffer.from(MIDTRANS_SERVER_KEY + ':').toString('base64')
    };
}

export async function createPaymentLink(userId, tier, amount, description) {
    if (!MIDTRANS_SERVER_KEY) {
        return {
            success: false,
            message: 'Payment gateway not configured. Contact admin.',
            fallback: true
        };
    }

    const orderId = `LUXX-${tier.toUpperCase()}-${Date.now()}-${userId.slice(-4)}`;
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    try {
        const response = await axios.post(
            `${MIDTRANS_BASE_URL}/v2/charge`,
            {
                payment_type: 'qris',
                qris: {
                    acquirer: 'gopay'
                },
                transaction_details: {
                    order_id: orderId,
                    gross_amount: amount
                },
                customer_details: {
                    first_name: 'LuxxBot User',
                    email: 'user@luxxbot.app',
                    phone: userId.replace(/[^0-9]/g, '')
                },
                metadata: {
                    userId,
                    tier,
                    description
                },
                expiry: {
                    start_time: new Date().toISOString(),
                    unit: 'minute',
                    duration: 30
                }
            },
            { headers: getMidtransHeaders() }
        );

        return {
            success: true,
            orderId,
            amount,
            qrisUrl: response.data.actions?.find(a => a.name === 'generate-qr-code')?.url,
            qrisString: response.data.actions?.find(a => a.name === 'generate-qr-code')?.content,
            expiresAt,
            status: response.data.transaction_status
        };
    } catch (error) {
        console.error('Payment link creation failed:', error.response?.data || error.message);
        return {
            success: false,
            message: 'Payment service unavailable. Please try again later.',
            error: error.message
        };
    }
}

export function formatPaymentMessage(result, tier) {
    if (result.success && result.qrisUrl) {
        return `💳 *PAYMENT: ${tier.toUpperCase()}*\n\n` +
            `📱 Scan QR untuk bayar:\n${result.qrisUrl}\n\n` +
            `💰 Amount: Rp ${result.amount.toLocaleString('id-ID')}\n` +
            `⏰ Expires: ${new Date(result.expiresAt).toLocaleString('id-ID')}\n\n` +
            `Setelah bayar, kirim bukti pembayaran ke owner.`;
    }
    return `❌ Payment Error\n\n${result.message}\n\nSilakan hubungi owner untuk pembayaran manual.`;
}

export async function validatePayment(orderId) {
    if (!MIDTRANS_SERVER_KEY) return { valid: false, status: 'unconfigured' };

    try {
        const response = await axios.get(
            `${MIDTRANS_BASE_URL}/v2/${orderId}/status`,
            { headers: getMidtransHeaders() }
        );
        return {
            valid: response.data?.transaction_status === 'settlement',
            status: response.data?.transaction_status || 'unknown',
            orderId
        };
    } catch {
        return { valid: false, status: 'error' };
    }
}
