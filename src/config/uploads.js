const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Where uploaded files live.
 *
 * Payment proofs are the only uploads, and they are private: stored outside
 * public/, never served statically, and reachable only through the
 * authenticated proof route.
 *
 * The location is one setting rather than a path repeated at each use, so
 * moving it — onto a mounted volume, a larger disk, somewhere that survives
 * a redeploy — is a deployment decision and not a code change. The default
 * keeps the repo self-contained: uploads/ next to the source, gitignored.
 *
 * Note this is a real directory on whichever machine runs the app. If that
 * filesystem is ephemeral, so is every payment proof on it, and an order
 * can end up claiming a verified payment it can no longer evidence.
 */
/**
 * The suite runs against a throwaway database but writes real files, so
 * without this it uses — and, now that a sweep exists, deletes from — the
 * same directory as the development app. Every `npm test` would strand
 * proof files there, and a sweep finding no matching orders in the test
 * database would treat genuine uploads as orphans. Tests get their own
 * directory, and the isolation lives here rather than in a setup file
 * someone has to remember to wire up.
 */
function resolveUploadDir() {
  if (process.env.UPLOAD_DIR) return path.resolve(process.env.UPLOAD_DIR);
  if (process.env.NODE_ENV === 'test') return path.join(os.tmpdir(), 'flavor-and-color-test-uploads');
  return path.join(__dirname, '..', '..', 'uploads');
}

const UPLOAD_DIR = resolveUploadDir();

const PROOFS_DIR = path.join(UPLOAD_DIR, 'proofs');

fs.mkdirSync(PROOFS_DIR, { recursive: true });

module.exports = { UPLOAD_DIR, PROOFS_DIR };
