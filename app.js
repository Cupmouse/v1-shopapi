const express = require('express');

const createError = require('http-errors');
const logger = require('morgan');
const helmet = require('helmet');
const cors = require('cors');
const sqlite3 = require('sqlite3');

const { CORS_ORIGIN, PATH_DATA_DB } = require('./common');

const Redis = require('./utils/redis');

const sqlite = new sqlite3.Database(PATH_DATA_DB);
const redis = new Redis();

const userRouter = require('./user/user');
const shopRouter = require('./shop/shop');
const orderRouter = require('./order/order');
const getRouter = require('./get');

const app = express();

app.use(logger('dev'));
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());
app.use(helmet());

app.use('/user', userRouter(redis, sqlite));
app.use('/shop', shopRouter(sqlite));
app.use('/get', getRouter(redis, sqlite));
app.post('/order', orderRouter(redis, sqlite));

// catch 404 and forward to error handler
app.use((req, res, next) => {
  next(createError(404, 'Resource not found'));
});

// error handler
app.use((err, req, res, next) => {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};
  
  console.log(err)
  const statusCode = err.statusCode === undefined ? 500 : err.statusCode;
  res.status(statusCode).json({error: err.message});
});

module.exports = app;
