const pool = require('../config/db');

const PaymentController = {
    // Upload payment screenshot
    uploadPaymentScreenshot: async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({ error: 'No file uploaded' });
            }
            
            // Store in payments folder
            const fileUrl = `/uploads/payments/${req.file.filename}`;
            
            res.json({
                success: true,
                file: {
                    url: fileUrl,
                    name: req.file.originalname,
                    type: req.file.mimetype,
                    size: req.file.size,
                    filename: req.file.filename,
                    category: 'payment'
                }
            });
        } catch (error) {
            console.error('Error uploading payment screenshot:', error);
            res.status(500).json({ error: 'Failed to upload payment screenshot' });
        }
    },

    // Create payment intent
    createPaymentIntent: async (req, res) => {
        try {
            const { appointment_id, amount, plan_name } = req.body;
            const user_id = req.user.id;

            console.log('Creating payment intent:', { appointment_id, amount, user_id });

            if (!appointment_id || !amount) {
                return res.status(400).json({ error: 'Missing required fields: appointment_id and amount' });
            }

            // Check if appointment exists
            const appointmentCheck = await pool.query(
                'SELECT id FROM appointments WHERE id = $1 AND patient_id = $2',
                [appointment_id, user_id]
            );

            if (appointmentCheck.rows.length === 0) {
                return res.status(404).json({ error: 'Appointment not found' });
            }

            // Generate unique payment ID
            const paymentId = 'PAY-' + Date.now() + '-' + Math.random().toString(36).substr(2, 8);
            
            // Insert payment record - only insert columns that exist
            const result = await pool.query(
                `INSERT INTO payments (appointment_id, user_id, amount, status, payment_id)
                 VALUES ($1, $2, $3, 'pending', $4)
                 RETURNING *`,
                [appointment_id, user_id, amount, paymentId]
            );

            console.log('Payment created:', result.rows[0]);

            res.json({
                success: true,
                id: result.rows[0].id,
                clientSecret: paymentId,
                amount: amount,
                paymentId: paymentId
            });

        } catch (error) {
            console.error('Error creating payment intent:', error);
            res.status(500).json({ error: 'Failed to create payment', details: error.message });
        }
    },

    // Confirm payment with screenshot
    confirmPayment: async (req, res) => {
        const client = await pool.connect();
        try {
            const { payment_id, appointment_id, screenshot_url } = req.body;
            const user_id = req.user.id;

            console.log('Confirming payment:', { payment_id, appointment_id, user_id, screenshot_url });

            if (!payment_id || !appointment_id) {
                return res.status(400).json({ error: 'Missing payment_id or appointment_id' });
            }

            await client.query('BEGIN');

            // Update payment status - only update columns that exist
            const paymentResult = await client.query(
                `UPDATE payments 
                 SET status = 'completed', 
                     updated_at = CURRENT_TIMESTAMP,
                     transaction_id = $3
                 WHERE payment_id = $1 AND user_id = $2
                 RETURNING *`,
                [payment_id, user_id, 'TXN-' + Date.now()]
            );

            if (paymentResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Payment not found' });
            }

            // Update appointment payment status
            const appointmentResult = await client.query(
                `UPDATE appointments 
                 SET payment_status = 'paid', 
                     status = 'confirmed', 
                     updated_at = CURRENT_TIMESTAMP,
                     notes = COALESCE(notes, '') || '\nPayment Screenshot: ' || $3
                 WHERE id = $1 AND patient_id = $2
                 RETURNING *`,
                [appointment_id, user_id, screenshot_url || 'No screenshot']
            );

            await client.query('COMMIT');

            console.log('Payment confirmed successfully');

            res.json({
                success: true,
                payment: paymentResult.rows[0],
                appointment: appointmentResult.rows[0]
            });

        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error confirming payment:', error);
            res.status(500).json({ error: 'Failed to confirm payment', details: error.message });
        } finally {
            client.release();
        }
    },

    // Get payment status
    getPaymentStatus: async (req, res) => {
        try {
            const { paymentId } = req.params;
            const user_id = req.user.id;

            const result = await pool.query(
                `SELECT * FROM payments 
                 WHERE payment_id = $1 AND user_id = $2`,
                [paymentId, user_id]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Payment not found' });
            }

            res.json(result.rows[0]);

        } catch (error) {
            console.error('Error fetching payment:', error);
            res.status(500).json({ error: 'Failed to fetch payment status' });
        }
    },

    // Get user's payment history
    getUserPayments: async (req, res) => {
        try {
            const user_id = req.user.id;

            const result = await pool.query(
                `SELECT p.*, 
                        a.appointment_date, 
                        a.appointment_time, 
                        d.name as doctor_name, 
                        pl.name as plan_name
                 FROM payments p
                 JOIN appointments a ON a.id = p.appointment_id
                 JOIN users d ON d.id = a.doctor_id
                 JOIN plans pl ON pl.id = a.plan_id
                 WHERE p.user_id = $1
                 ORDER BY p.created_at DESC`,
                [user_id]
            );

            res.json(result.rows);

        } catch (error) {
            console.error('Error fetching payments:', error);
            res.status(500).json({ error: 'Failed to fetch payments' });
        }
    }
};

module.exports = PaymentController;