const AuthEvent = require('../models/AuthEvent');

/**
 * Records a security event. Fire-and-forget by design: the audit log must
 * never break the flow it is recording, so failures are swallowed.
 */
function record(type, { email = '', actorName = '', ip = '', note = '' } = {}) {
  return AuthEvent.create({ type, email, actorName, ip, note }).catch(() => {});
}

module.exports = { record };
