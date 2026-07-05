const fs = require('fs');
const path = require('path');
const multer = require('multer');
const ApiError = require('../utils/ApiError');

/**
 * Proof-of-payment uploads. Files land in uploads/proofs (gitignored,
 * outside public/) and are only ever served through the authenticated
 * proof endpoint — payment screenshots are private.
 */
const PROOFS_DIR = path.join(__dirname, '..', '..', 'uploads', 'proofs');
fs.mkdirSync(PROOFS_DIR, { recursive: true });

const ALLOWED_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

const storage = multer.diskStorage({
  destination: PROOFS_DIR,
  filename: (req, file, cb) => {
    cb(null, `${req.params.id}-${Date.now()}${ALLOWED_TYPES[file.mimetype]}`);
  },
});

const uploadProof = multer({
  storage,
  limits: { fileSize: MAX_SIZE_BYTES },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_TYPES[file.mimetype]) {
      return cb(new ApiError(422, 'Proof must be a JPG, PNG, or WebP image.'));
    }
    cb(null, true);
  },
}).single('proof');

module.exports = { uploadProof, PROOFS_DIR };
