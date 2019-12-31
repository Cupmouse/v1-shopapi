const express = require('express');

const createError = require('http-errors');
const logger = require('morgan');
const helmet = require('helmet');
const cors = require('cors')
const bcrypt = require('bcrypt');
const util = require('util');
const sqlite3 = require('sqlite3');

const { CORS_ORIGIN, PATH_DATA_DB } = require('./common');
const Redis = require('./utils/redis');

const cors_option = {
  origin: CORS_ORIGIN,
};
const sqlite = new sqlite3.Database(PATH_DATA_DB);
const redis = new Redis();

const userRouter = require('./user');
const shopRouter = require('./shop');
const orderRouter = require('./order');
const getRouter = require('./get');

const app = express();

app.use(logger('dev'));
app.use(cors(cors_option))
app.use(express.json());
// app.use(express.urlencoded({ extended: false }));
app.use(helmet());

app.use('/user', userRouter(redis, sqlite));
app.use('/shop', shopRouter(sqlite));
app.use('/order', orderRouter(redis, sqlite));
app.use('/get', getRouter(redis, sqlite));

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404, 'Resource not found'));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};
  
  console.log(err)
  const statusCode = err.statusCode === undefined ? 500 : err.statusCode;
  res.status(statusCode).json({error: err.message});
});

module.exports = app;
