const pool = require('../config/db');

const PaymentController = {
    // Upload payment screenshot
    uploadPaymentScreenshot: async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({ error: 'No file uploaded' });
            }
            
            const fileUrl = `/uploads/payments/${req.file.filename}`;
            
            console.log('Screenshot uploaded:', fileUrl);
            
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
    async createPaymentIntent(req, res) {
        try {
            const { appointment_id, amount, plan_name } = req.body;
            const user_id = req.user.id;

            console.log('Creating payment intent:', { appointment_id, amount, user_id });

            if (!appointment_id || !amount) {
                return res.status(400).json({ error: 'Missing required fields: appointment_id and amount' });
            }

            // Check if appointment exists and belongs to user
            const appointmentCheck = await pool.query(
                'SELECT * FROM appointments WHERE id = $1 AND patient_id = $2',
                [appointment_id, user_id]
            );

            if (appointmentCheck.rows.length === 0) {
                return res.status(404).json({ error: 'Appointment not found' });
            }

            // Generate unique payment ID
            const paymentId = 'PAY-' + Date.now() + '-' + Math.random().toString(36).substr(2, 8);
            
            // Insert payment record - only use columns that exist
            const result = await pool.query(
                `INSERT INTO payments (appointment_id, user_id, amount, status, payment_id, payment_method, created_at, updated_at)
                 VALUES ($1, $2, $3, 'pending', $4, 'bank_transfer', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
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

    // Submit payment with screenshot
    // Submit payment with screenshot
// Submit payment with screenshot
async submitPayment(req, res) {
    const client = await pool.connect();
    try {
        const { payment_id, appointment_id, screenshot_url } = req.body;
        const user_id = req.user.id;

        console.log('=== SUBMIT PAYMENT CALLED ===');
        console.log('Request body:', JSON.stringify(req.body, null, 2));
        console.log('User ID:', user_id);

        // Validate required fields
        if (!payment_id) {
            return res.status(400).json({ error: 'Payment ID is required' });
        }
        if (!appointment_id) {
            return res.status(400).json({ error: 'Appointment ID is required' });
        }
        if (!screenshot_url) {
            return res.status(400).json({ error: 'Screenshot URL is required' });
        }

        await client.query('BEGIN');

        // Check if appointment exists and belongs to user
        const appointmentCheck = await client.query(
            'SELECT * FROM appointments WHERE id = $1 AND patient_id = $2',
            [appointment_id, user_id]
        );

        if (appointmentCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Appointment not found' });
        }

        // Update payment with screenshot - FIXED QUERY
        // Update payment with screenshot
const updateResult = await client.query(
    `UPDATE payments 
     SET status = 'pending', 
         notes = $1,
         updated_at = CURRENT_TIMESTAMP
     WHERE payment_id = $2
     RETURNING *`,
    [screenshot_url, payment_id]
);

        console.log('Payment update result:', updateResult.rows);

        // Update appointment status
        const appointmentResult = await client.query(
            `UPDATE appointments
             SET payment_status = 'pending_verification',
                 status = 'pending',
                 updated_at = CURRENT_TIMESTAMP,
                 notes = COALESCE(notes, '') || '\nPayment Screenshot: ' || $1
             WHERE id = $2 AND patient_id = $3
             RETURNING *`,
            [screenshot_url, appointment_id, user_id]
        );

        console.log('Appointment update result:', appointmentResult.rows);

        await client.query('COMMIT');

        console.log('Payment submitted successfully');

        res.json({
            success: true,
            message: 'Payment submitted successfully. Waiting for doctor verification.',
            payment: updateResult.rows[0],
            appointment: appointmentResult.rows[0]
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error submitting payment:', error);
        res.status(500).json({ error: 'Failed to submit payment', details: error.message });
    } finally {
        client.release();
    }
},
    // Doctor verifies payment
    // Doctor verifies payment
// Doctor verifies payment
async verifyPayment(req, res) {
    const client = await pool.connect();
    try {
        const { payment_id, appointment_id, approved } = req.body;
        
        // Check if user is doctor
        if (req.user.role !== 'doctor') {
            return res.status(403).json({ error: 'Only doctors can verify payments' });
        }

        console.log('Verifying payment:', { payment_id, appointment_id, approved });

        if (!payment_id || !appointment_id) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        await client.query('BEGIN');

        if (approved) {
            // Update payment status
            const paymentResult = await client.query(
                `UPDATE payments
                 SET status = 'completed',
                     verified_by = $2,
                     verified_at = CURRENT_TIMESTAMP,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE payment_id = $1
                 RETURNING *`,
                [payment_id, req.user.id]
            );

            // Update appointment - BOTH status and payment_status
            const appointmentResult = await client.query(
                `UPDATE appointments 
                 SET status = 'confirmed', 
                     payment_status = 'paid', 
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = $1
                 RETURNING *`,
                [appointment_id]
            );

            await client.query('COMMIT');

            console.log('Payment verified and appointment confirmed:', appointmentResult.rows[0]);

            const patientId = appointmentResult.rows[0].patient_id;

            // Emit real-time plan-updated event so patient's chat page unlocks immediately
            if (global.emitToUser) {
                global.emitToUser(patientId, 'plan-updated', {
                    appointment_id,
                    message: 'Your payment has been verified. Chat is now unlocked!'
                });
            }

            // Send notification to patient
            if (global.sendNotification) {
                await global.sendNotification(
                    patientId,
                    'payment_verified',
                    'Payment Verified!',
                    `Your payment has been verified. Your appointment is now confirmed.`,
                    { appointment_id, status: 'confirmed' }
                );
            }

            res.json({
                success: true,
                message: 'Payment verified and appointment confirmed. Patient can now chat.',
                payment: paymentResult.rows[0],
                appointment: appointmentResult.rows[0]
            });
        } else {
            // Reject payment
            const paymentResult = await client.query(
                `UPDATE payments
                 SET status = 'rejected',
                     verified_by = $2,
                     verified_at = CURRENT_TIMESTAMP,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE payment_id = $1
                 RETURNING *`,
                [payment_id, req.user.id]
            );

            // Update appointment - set to cancelled
            const appointmentResult = await client.query(
                `UPDATE appointments 
                 SET status = 'cancelled', 
                     payment_status = 'failed', 
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = $1
                 RETURNING *`,
                [appointment_id]
            );

            await client.query('COMMIT');

            // Send notification to patient
            if (global.sendNotification) {
                await global.sendNotification(
                    appointmentResult.rows[0].patient_id,
                    'payment_rejected',
                    'Payment Rejected',
                    `Your payment was rejected. Please contact support or try again.`,
                    { appointment_id, status: 'cancelled' }
                );
            }

            res.json({
                success: true,
                message: 'Payment rejected. Appointment cancelled.',
                payment: paymentResult.rows[0],
                appointment: appointmentResult.rows[0]
            });
        }

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error verifying payment:', error);
        res.status(500).json({ error: 'Failed to verify payment', details: error.message });
    } finally {
        client.release();
    }
},

    // Get payment status
    async getPaymentStatus(req, res) {
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

    // Admin: get all payments
    async getAllPayments(req, res) {
        try {
            if (req.user.role !== 'admin') {
                return res.status(403).json({ error: 'Admin access required' });
            }

            const { status } = req.query;
            let query = `
                SELECT p.*,
                       a.appointment_date, a.appointment_time,
                       pt.name as patient_name, pt.email as patient_email,
                       dr.name as doctor_name,
                       pl.name as plan_name
                FROM payments p
                JOIN appointments a ON a.id = p.appointment_id
                JOIN users pt ON pt.id = p.user_id
                JOIN users dr ON dr.id = a.doctor_id
                JOIN plans pl ON pl.id = a.plan_id
                WHERE 1=1
            `;
            const params = [];
            if (status) { query += ` AND p.status = $1`; params.push(status); }
            query += ` ORDER BY p.created_at DESC`;

            const result = await pool.query(query, params);
            res.json(result.rows);
        } catch (error) {
            console.error('Error fetching all payments:', error);
            res.status(500).json({ error: 'Failed to fetch payments' });
        }
    },

    // Get user's payment history
    async getUserPayments(req, res) {
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