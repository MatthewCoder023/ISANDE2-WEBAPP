const Notification = require('../models/Notification');
const User = require('../models/User');

/**
 * In-app notifications.
 *
 * Fire-and-forget, like the audit trail and the mailer: a message failing
 * to save must never break the order or mix flow that produced it.
 */

/** Delivers to one person. Silently ignores a missing recipient. */
async function notifyUser(recipientId, { type, title, body = '', link = '' }) {
  try {
    if (!recipientId) return null;
    return await Notification.create({ recipient: recipientId, type, title, body, link });
  } catch (err) {
    console.error(`In-app notification "${type}" failed:`, err.message);
    return null;
  }
}

/**
 * Delivers to everyone currently holding one of the given roles — used for
 * work that lands on a desk rather than with a named person, like a proof
 * waiting to be checked. Deactivated accounts are skipped.
 */
async function notifyRoles(roles, { type, title, body = '', link = '' }) {
  try {
    const staff = await User.find({ role: { $in: roles }, isActive: true }).select('_id');
    if (staff.length === 0) return 0;

    await Notification.insertMany(
      staff.map((user) => ({ recipient: user._id, type, title, body, link }))
    );
    return staff.length;
  } catch (err) {
    console.error(`In-app notification "${type}" to ${roles.join('/')} failed:`, err.message);
    return 0;
  }
}

module.exports = { notifyUser, notifyRoles };
