const pool = require('../config/db');

class NotificationController {
    // Create a notification
    async createNotification(userId, type, title, message, data = null) {
        try {
            const result = await pool.query(
                `INSERT INTO notifications (user_id, type, title, message, data)
                 VALUES ($1, $2, $3, $4, $5)
                 RETURNING *`,
                [userId, type, title, message, data]
            );
            return result.rows[0];
        } catch (error) {
            console.error('Error creating notification:', error);
            return null;
        }
    }

    // Get user's notifications
    async getUserNotifications(req, res) {
        try {
            const userId = req.user.id;
            const { limit = 50, offset = 0, unreadOnly = false } = req.query;

            let query = `
                SELECT * FROM notifications 
                WHERE user_id = $1
            `;
            const params = [userId];
            let paramCount = 2;

            if (unreadOnly === 'true') {
                query += ` AND is_read = false`;
            }

            query += ` ORDER BY created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
            params.push(limit, offset);

            const result = await pool.query(query, params);
            
            // Get unread count
            const unreadCount = await pool.query(
                `SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = false`,
                [userId]
            );

            res.json({
                notifications: result.rows,
                unreadCount: parseInt(unreadCount.rows[0].count),
                total: result.rows.length
            });
        } catch (error) {
            console.error('Error fetching notifications:', error);
            res.status(500).json({ error: 'Failed to fetch notifications' });
        }
    }

    // Mark notification as read
    async markAsRead(req, res) {
        try {
            const { id } = req.params;
            const userId = req.user.id;

            const result = await pool.query(
                `UPDATE notifications 
                 SET is_read = true, updated_at = CURRENT_TIMESTAMP
                 WHERE id = $1 AND user_id = $2
                 RETURNING *`,
                [id, userId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Notification not found' });
            }

            res.json(result.rows[0]);
        } catch (error) {
            console.error('Error marking notification as read:', error);
            res.status(500).json({ error: 'Failed to mark notification as read' });
        }
    }

    // Mark all notifications as read
    async markAllAsRead(req, res) {
        try {
            const userId = req.user.id;

            await pool.query(
                `UPDATE notifications 
                 SET is_read = true, updated_at = CURRENT_TIMESTAMP
                 WHERE user_id = $1 AND is_read = false`,
                [userId]
            );

            res.json({ message: 'All notifications marked as read' });
        } catch (error) {
            console.error('Error marking all notifications as read:', error);
            res.status(500).json({ error: 'Failed to mark notifications as read' });
        }
    }

    // Delete notification
    async deleteNotification(req, res) {
        try {
            const { id } = req.params;
            const userId = req.user.id;

            const result = await pool.query(
                `DELETE FROM notifications WHERE id = $1 AND user_id = $2 RETURNING id`,
                [id, userId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Notification not found' });
            }

            res.json({ message: 'Notification deleted' });
        } catch (error) {
            console.error('Error deleting notification:', error);
            res.status(500).json({ error: 'Failed to delete notification' });
        }
    }

    // Get unread count
    async getUnreadCount(req, res) {
        try {
            const userId = req.user.id;

            const result = await pool.query(
                `SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = false`,
                [userId]
            );

            res.json({ unreadCount: parseInt(result.rows[0].count) });
        } catch (error) {
            console.error('Error getting unread count:', error);
            res.status(500).json({ error: 'Failed to get unread count' });
        }
    }
}

module.exports = new NotificationController();