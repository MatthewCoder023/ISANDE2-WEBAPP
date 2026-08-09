const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const ApiError = require('../utils/ApiError');
const { PROOFS_DIR } = require('../config/uploads');

/**
 * Proof-of-payment uploads. The directory itself is configured in
 * config/uploads.js; everything here is about what may be written into it.
 */

const ALLOWED_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

const storage = multer.diskStorage({
  destination: PROOFS_DIR,
  // The stored name is generated entirely server-side: request data
  // (params, original filename) must never reach the filesystem path.
  filename: (req, file, cb) => {
    cb(null, `${crypto.randomUUID()}${ALLOWED_TYPES[file.mimetype]}`);
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

/** The declared MIME type is client input; the file's first bytes are not. */
function looksLike(header, mimetype) {
  switch (mimetype) {
    case 'image/jpeg':
      return header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
    case 'image/png':
      return header.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
    case 'image/webp':
      return header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP';
    default:
      return false;
  }
}

/**
 * Runs after multer: verifies the stored file actually begins like the
 * image format it claims to be, and removes it if not.
 */
function verifyProofImage(req, res, next) {
  if (!req.file) return next(); // the controller raises its own 422

  fs.open(req.file.path, 'r', (openErr, fd) => {
    if (openErr) return next(openErr);
    const header = Buffer.alloc(12);
    fs.read(fd, header, 0, 12, 0, (readErr) => {
      fs.close(fd, () => {});
      if (readErr) return next(readErr);
      if (!looksLike(header, req.file.mimetype)) {
        fs.unlink(req.file.path, () => {});
        return next(new ApiError(422, 'That file does not appear to be a valid image.'));
      }
      next();
    });
  });
}

module.exports = { uploadProof, verifyProofImage };
