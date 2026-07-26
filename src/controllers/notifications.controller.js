const Notification = require('../models/Notification');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

/**
 * Everything here is scoped to the caller by recipient — there is no way to
 * read or touch someone else's notifications, whatever their role.
 */

/** GET /api/notifications — the caller's recent messages and unread count. */
const list = asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 15, 1), 50);

  const [notifications, unread] = await Promise.all([
    Notification.find({ recipient: req.user._id }).sort('-createdAt').limit(limit),
    Notification.countDocuments({ recipient: req.user._id, readAt: null }),
  ]);

  res.json({
    success: true,
    data: { notifications: notifications.map((n) => n.toJSON()), unread },
  });
});

/** GET /api/notifications/unread-count — cheap poll for the bell badge. */
const unreadCount = asyncHandler(async (req, res) => {
  const unread = await Notification.countDocuments({ recipient: req.user._id, readAt: null });
  res.json({ success: true, data: { unread } });
});

/** POST /api/notifications/:id/read — marks one as read. */
const markRead = asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, recipient: req.user._id },
    { $set: { readAt: new Date() } },
    { new: true }
  );

  if (!notification) throw new ApiError(404, 'Notification not found.');
  res.json({ success: true, data: { notification: notification.toJSON() } });
});

/** POST /api/notifications/read-all — clears the badge in one go. */
const markAllRead = asyncHandler(async (req, res) => {
  const result = await Notification.updateMany(
    { recipient: req.user._id, readAt: null },
    { $set: { readAt: new Date() } }
  );

  res.json({ success: true, data: { marked: result.modifiedCount } });
});

module.exports = { list, unreadCount, markRead, markAllRead };
