const path = require('path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const mongoose = require('mongoose');
const morgan = require('morgan');

const apiRoutes = require('./routes');
const pageRoutes = require('./routes/pages.routes');
const { notFound, errorHandler } = require('./middleware/errorHandler');

/**
 * App factory: called after the DB connection is established so the
 * session store can reuse the existing Mongoose connection.
 */
function createApp() {
  const app = express();
  const isProduction = process.env.NODE_ENV === 'production';

  app.set('trust proxy', 1);

  // Security headers. CSP is enforced in production; disabled in development
  // because upgrade-insecure-requests interferes with http://localhost.
  app.use(helmet({ contentSecurityPolicy: isProduction ? undefined : false }));

  if (!isProduction && process.env.NODE_ENV !== 'test') {
    app.use(morgan('dev'));
  }

  app.use(express.json({ limit: '10kb' }));
  app.use(express.urlencoded({ extended: false }));

  app.use(
    session({
      name: 'fc.sid',
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      store: MongoStore.create({
        client: mongoose.connection.getClient(),
        collectionName: 'sessions',
      }),
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProduction,
        maxAge: 8 * 60 * 60 * 1000, // 8 hours
      },
    })
  );

  // Public assets and pages. extensions: ['html'] gives clean URLs
  // (/login serves public/login.html).
  app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

  app.use('/api', apiRoutes);
  app.use('/', pageRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
