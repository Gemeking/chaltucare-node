const pool = require('../config/db');

class AppointmentController {
    // Get all plans
    async getPlans(req, res) {
        try {
            console.log('Fetching plans from database...');
            const result = await pool.query(
                'SELECT * FROM plans WHERE is_active = true ORDER BY price'
            );
            console.log('Plans found:', result.rows.length);
            res.json(result.rows);
        } catch (error) {
            console.error('Error fetching plans:', error);
            res.status(500).json({ error: 'Failed to fetch plans', details: error.message });
        }
    }

    // Create a new appointment
    async createAppointment(req, res) {
        const client = await pool.connect();
        try {
            const { doctor_id, plan_id, appointment_date, appointment_time, reason, amount } = req.body;
            const patient_id = req.user.id;

            if (!doctor_id || !plan_id || !appointment_date || !appointment_time) {
                return res.status(400).json({ error: 'Missing required fields' });
            }

            await client.query('BEGIN');

            // Check if doctor exists
            const doctorCheck = await client.query(
                'SELECT id, name, email FROM users WHERE id = $1 AND role = $2',
                [doctor_id, 'doctor']
            );
            if (doctorCheck.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Doctor not found' });
            }

            // Check if plan exists
            const planCheck = await client.query(
                'SELECT * FROM plans WHERE id = $1 AND is_active = true',
                [plan_id]
            );
            if (planCheck.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Plan not found' });
            }

            // Check if slot is available
            const slotCheck = await client.query(
                `SELECT id FROM appointments 
                 WHERE doctor_id = $1 
                 AND appointment_date = $2 
                 AND appointment_time = $3 
                 AND status NOT IN ('cancelled', 'rejected')`,
                [doctor_id, appointment_date, appointment_time]
            );

            if (slotCheck.rows.length > 0) {
                await client.query('ROLLBACK');
                return res.status(409).json({ error: 'Time slot already booked' });
            }

            // Create appointment
            const result = await client.query(
                `INSERT INTO appointments 
                 (patient_id, doctor_id, plan_id, appointment_date, appointment_time, reason, status, payment_status)
                 VALUES ($1, $2, $3, $4, $5, $6, 'pending', 'pending')
                 RETURNING *`,
                [patient_id, doctor_id, plan_id, appointment_date, appointment_time, reason]
            );

            const appointment = result.rows[0];

            await client.query('COMMIT');

            res.status(201).json({
                ...appointment,
                doctor: doctorCheck.rows[0],
                plan: planCheck.rows[0]
            });

        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error creating appointment:', error);
            res.status(500).json({ error: 'Failed to create appointment' });
        } finally {
            client.release();
        }
    }

    // Get user's appointments
    async getUserAppointments(req, res) {
        try {
            const userId = req.user.id;
            const { status } = req.query;

            let query = `
                SELECT a.*, 
                       u.name as doctor_name, 
                       u.email as doctor_email,
                       p.name as plan_name,
                       p.price as plan_price,
                       p.duration_minutes
                FROM appointments a
                JOIN users u ON u.id = a.doctor_id
                JOIN plans p ON p.id = a.plan_id
                WHERE a.patient_id = $1
            `;
            const params = [userId];

            if (status) {
                query += ` AND a.status = $2`;
                params.push(status);
            }

            query += ` ORDER BY a.appointment_date DESC, a.appointment_time DESC`;

            const result = await pool.query(query, params);
            res.json(result.rows);

        } catch (error) {
            console.error('Error fetching appointments:', error);
            res.status(500).json({ error: 'Failed to fetch appointments' });
        }
    }

    // Get doctor's appointments
    async getDoctorAppointments(req, res) {
        try {
            const doctorId = req.user.id;
            const { status, date } = req.query;

            let query = `
                SELECT a.*, 
                       u.name as patient_name, 
                       u.email as patient_email,
                       p.name as plan_name,
                       p.price as plan_price
                FROM appointments a
                JOIN users u ON u.id = a.patient_id
                JOIN plans p ON p.id = a.plan_id
                WHERE a.doctor_id = $1
            `;
            const params = [doctorId];
            let paramIndex = 2;

            if (status) {
                query += ` AND a.status = $${paramIndex}`;
                params.push(status);
                paramIndex++;
            }

            if (date) {
                query += ` AND a.appointment_date = $${paramIndex}`;
                params.push(date);
            }

            query += ` ORDER BY a.appointment_date ASC, a.appointment_time ASC`;

            const result = await pool.query(query, params);
            res.json(result.rows);

        } catch (error) {
            console.error('Error fetching doctor appointments:', error);
            res.status(500).json({ error: 'Failed to fetch appointments' });
        }
    }

    // Update appointment status
    async updateAppointmentStatus(req, res) {
        try {
            const { id } = req.params;
            const { status, notes } = req.body;
            const userId = req.user.id;
            const userRole = req.user.role;

            // Check if appointment exists and user has permission
            const appointment = await pool.query(
                `SELECT * FROM appointments WHERE id = $1`,
                [id]
            );

            if (appointment.rows.length === 0) {
                return res.status(404).json({ error: 'Appointment not found' });
            }

            const appt = appointment.rows[0];

            // Check permissions
            if (userRole === 'patient' && appt.patient_id !== userId) {
                return res.status(403).json({ error: 'Not authorized' });
            }
            if (userRole === 'doctor' && appt.doctor_id !== userId) {
                return res.status(403).json({ error: 'Not authorized' });
            }

            // Update status
            const result = await pool.query(
                `UPDATE appointments 
                 SET status = $1, notes = COALESCE($2, notes), updated_at = CURRENT_TIMESTAMP
                 WHERE id = $3
                 RETURNING *`,
                [status, notes, id]
            );

            res.json(result.rows[0]);

        } catch (error) {
            console.error('Error updating appointment:', error);
            res.status(500).json({ error: 'Failed to update appointment' });
        }
    }

    // Get appointment details
    async getAppointmentById(req, res) {
        try {
            const { id } = req.params;
            const userId = req.user.id;
            const userRole = req.user.role;

            const result = await pool.query(
                `SELECT a.*, 
                        p.name as patient_name, p.email as patient_email,
                        d.name as doctor_name, d.email as doctor_email,
                        pl.name as plan_name, pl.price as plan_price, pl.features
                 FROM appointments a
                 JOIN users p ON p.id = a.patient_id
                 JOIN users d ON d.id = a.doctor_id
                 JOIN plans pl ON pl.id = a.plan_id
                 WHERE a.id = $1`,
                [id]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Appointment not found' });
            }

            const appointment = result.rows[0];

            // Check permission
            if (userRole !== 'admin' && appointment.patient_id !== userId && appointment.doctor_id !== userId) {
                return res.status(403).json({ error: 'Not authorized' });
            }

            res.json(appointment);

        } catch (error) {
            console.error('Error fetching appointment:', error);
            res.status(500).json({ error: 'Failed to fetch appointment' });
        }
    }

    // Add this method to the AppointmentController class
async createAppointment(req, res) {
    const client = await pool.connect();
    try {
        const { doctor_id, plan_id, appointment_date, appointment_time, reason, amount } = req.body;
        const patient_id = req.user.id;

        console.log('Creating appointment:', { doctor_id, plan_id, appointment_date, appointment_time, patient_id });

        if (!doctor_id || !plan_id || !appointment_date || !appointment_time) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        await client.query('BEGIN');

        // Check if doctor exists
        const doctorCheck = await client.query(
            'SELECT id, name, email FROM users WHERE id = $1 AND role = $2',
            [doctor_id, 'doctor']
        );
        if (doctorCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Doctor not found' });
        }

        // Check if plan exists
        const planCheck = await client.query(
            'SELECT * FROM plans WHERE id = $1 AND is_active = true',
            [plan_id]
        );
        if (planCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Plan not found' });
        }

        // Check if slot is available
        const slotCheck = await client.query(
            `SELECT id FROM appointments 
             WHERE doctor_id = $1 
             AND appointment_date = $2 
             AND appointment_time = $3 
             AND status NOT IN ('cancelled', 'rejected')`,
            [doctor_id, appointment_date, appointment_time]
        );

        if (slotCheck.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'Time slot already booked' });
        }

        // Create appointment
        const result = await client.query(
            `INSERT INTO appointments 
             (patient_id, doctor_id, plan_id, appointment_date, appointment_time, reason, status, payment_status)
             VALUES ($1, $2, $3, $4, $5, $6, 'pending', 'pending')
             RETURNING *`,
            [patient_id, doctor_id, plan_id, appointment_date, appointment_time, reason]
        );

        const appointment = result.rows[0];

        await client.query('COMMIT');

        console.log('Appointment created:', appointment);

        res.status(201).json({
            ...appointment,
            doctor: doctorCheck.rows[0],
            plan: planCheck.rows[0]
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error creating appointment:', error);
        res.status(500).json({ error: 'Failed to create appointment', details: error.message });
    } finally {
        client.release();
    }
}

    // Get available time slots for a doctor
    async getAvailableSlots(req, res) {
        try {
            const { doctorId, date } = req.params;

            if (!doctorId || !date) {
                return res.status(400).json({ error: 'Doctor ID and date required' });
            }

            // Get all time slots for the day
            const allSlots = [
                '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
                '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00'
            ];

            // Get booked slots
            const bookedSlots = await pool.query(
                `SELECT appointment_time 
                 FROM appointments 
                 WHERE doctor_id = $1 
                 AND appointment_date = $2 
                 AND status NOT IN ('cancelled', 'rejected')`,
                [doctorId, date]
            );

            const bookedTimes = new Set(bookedSlots.rows.map(row => row.appointment_time));
            const availableSlots = allSlots.filter(slot => !bookedTimes.has(slot));

            res.json(availableSlots);

        } catch (error) {
            console.error('Error fetching available slots:', error);
            res.status(500).json({ error: 'Failed to fetch available slots' });
        }
    }

    // Add message to appointment chat
    async addAppointmentMessage(req, res) {
        try {
            const { appointment_id, message } = req.body;
            const sender_id = req.user.id;

            if (!appointment_id || !message) {
                return res.status(400).json({ error: 'Appointment ID and message required' });
            }

            const result = await pool.query(
                `INSERT INTO appointment_messages (appointment_id, sender_id, message)
                 VALUES ($1, $2, $3)
                 RETURNING *`,
                [appointment_id, sender_id, message]
            );

            // Get sender info
            const sender = await pool.query(
                'SELECT id, name, role FROM users WHERE id = $1',
                [sender_id]
            );

            res.status(201).json({
                ...result.rows[0],
                sender: sender.rows[0]
            });

        } catch (error) {
            console.error('Error adding message:', error);
            res.status(500).json({ error: 'Failed to add message' });
        }
    }

    // Get appointment messages
    async getAppointmentMessages(req, res) {
        try {
            const { appointmentId } = req.params;
            const userId = req.user.id;

            // Verify access
            const appointment = await pool.query(
                `SELECT patient_id, doctor_id FROM appointments WHERE id = $1`,
                [appointmentId]
            );

            if (appointment.rows.length === 0) {
                return res.status(404).json({ error: 'Appointment not found' });
            }

            const appt = appointment.rows[0];
            if (appt.patient_id !== userId && appt.doctor_id !== userId) {
                return res.status(403).json({ error: 'Not authorized' });
            }

            const result = await pool.query(
                `SELECT m.*, u.name as sender_name, u.role as sender_role
                 FROM appointment_messages m
                 JOIN users u ON u.id = m.sender_id
                 WHERE m.appointment_id = $1
                 ORDER BY m.created_at ASC`,
                [appointmentId]
            );

            res.json(result.rows);

        } catch (error) {
            console.error('Error fetching messages:', error);
            res.status(500).json({ error: 'Failed to fetch messages' });
        }
    }
}

module.exports = new AppointmentController();