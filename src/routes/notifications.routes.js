const express = require('express');
const { isValidObjectId } = require('mongoose');

const notificationsController = require('../controllers/notifications.controller');
const { requireAuth } = require('../middleware/auth');
const ApiError = require('../utils/ApiError');

const router = express.Router();

// Every role has a bell; the controller scopes results to the caller.
router.use(requireAuth);

router.get('/', notificationsController.list);
router.get('/unread-count', notificationsController.unreadCount);
router.post('/read-all', notificationsController.markAllRead);

router.post(
  '/:id/read',
  (req, res, next) =>
    isValidObjectId(req.params.id)
      ? next()
      : next(new ApiError(400, 'Invalid identifier format.')),
  notificationsController.markRead
);

module.exports = router;
