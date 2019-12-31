const express = require('express');
const createError = require('http-errors');

const base64url = require('base64url');
const moment = require('moment');
const bcrypt = require('bcrypt');
const checkoutsdk = require('@paypal/checkout-server-sdk');

const { CALC_PRICE, SALT_ROUNDS, SESSION_TIME, LENGTH_SESSION_ID, PAYPAL_ID, PAYPAL_SECRET } = require('./common');
const { makeSQLBatch } = require('./utils/sqlite');
const { randomBytes } = require('./utils/promisified');
const { checkCaptcha } = require('./utils/recaptcha');

const newPaypalClient = () => new checkoutsdk.core.PayPalHttpClient(
  new checkoutsdk.core.SandboxEnvironment(PAYPAL_ID, PAYPAL_SECRET)
);;

const checkPassword = (req, res, next) => {
  if (typeof req.body === 'undefined' || typeof req.body.user_id !== 'string' || typeof req.body.password !== 'string') {
    // an access will be denied
    next(createError(400, 'Invalid parameters'));
  } else if (req.body.user_id.length < 3 || req.body.password.length < 5) {
    next(createError(400, 'Invalid parameters'));
  } else {
    next();
  }
};

module.exports = (redis, sqlite) => {
  const router = express.Router();

  router.post('/signup', checkPassword, checkCaptcha, (req, res, next) => {
    const user_id = req.body.user_id;
    const password = req.body.password;
  
    const key_password = 'user:' + user_id + ':password';
  
    bcrypt.hash(password, SALT_ROUNDS)
    .then(hashed => redis.SETNX(key_password, hashed))
    .then(set => {
      if (set === 1) {
        // user created
        res.json({'success': 'User created'});
      } else {
        next(createError(401, 'User with id "' + user_id + '" already exists'));
      }
    }).catch(function(err) {
      console.log(err);
      next(createError(500, 'Database error'));
    });
  });
  
  // login
  router.post('/login', checkPassword, checkCaptcha, (req, res, next) => {
    const user_id = req.body.user_id;
    const password = req.body.password;
  
    const key_session = 'user:' + user_id + ':session';
    const key_password = 'user:' + user_id + ':password';
  
    session_id = null;
  
    redis.GET(key_password)
    .then((stored) => {
      if (stored == null) {
        return Promise.reject('failed');
      } else {
        return bcrypt.compare(password, stored);
      }
    }).then((is_correct) => {
      if (is_correct) {
        // generate new session id
        return randomBytes(LENGTH_SESSION_ID);
      } else {
        // failed login
        return Promise.reject('failed');
      }
    }).then((bytes) => {
      session_id = bytes.toString('hex');
  
      return redis.SET(key_session, session_id);
    }).then((result) => {
      if (result === 'OK') {
        // set default expiery time
        return redis.PEXPIRE(key_session, SESSION_TIME);
      } else {
        return Promise.reject('notok');
      }
    }).then((timeout) => {
      // all procedure done, login ok
      if (timeout === 1) {
        res.json({'success': 'Successful login', 'session_id': session_id});
      } else {
        return Promise.reject('notok');
      }
    }).catch((err) => {
      // catched exception while autheticating
      if (err === 'failed') {
        next(createError(401, 'Authentication error: user id or password is incorrect'));
      } else if (err === 'notok') {
        next(createError(500, 'Session error'));
      } else {
        console.log(err)
        next(createError(500, 'Database error'));
      }
    });
  });
  
  // check if a user is logged in
  checkSession = (req, res, next) => {
    user_id = req.body.user_id;
    session_id = req.body.session_id;
  
    // check if parameters client given is valid
    if (typeof user_id !== 'string' || typeof session_id !== 'string') {
      next(createError(400, 'Invalid parameters'));
      return;
    }
  
    // check if session id client provided actually exist 
    key_session = 'user:' + user_id + ':session';
  
    redis.GET(key_session)
    .then((stored) => {
      if (stored === session_id) {
        // session id matched, great!
        next();
      } else {
        // wrong session id
        redis.DEL(key_session).then((num) => next(createError(401, 'You are not logged in')));
      }
    }).catch((err) => {
      console.log(err);
      next(createError(500, 'Database error'));
    });
  };
  
  extendSession = (req, res, next) => {
    key_session = 'user:' + user_id + ':session';
  
    // make session time longer
    redis.PEXPIRE(key_session, SESSION_TIME)
    .then((timeout) => {
      if (timeout === 1) {
        next();
      } else {
        return Promise.reject('notok');
      }
    }).catch((err) => {
      if (err === 'notok') {
        next(createError(500, 'Session error'));
      } else {
        console.log(err);
        next(createError(500, 'Database error'));
      }
    });
  };
  
  router.post('/isloggedin', checkSession, (req, res, next) => {
    res.json({'status': true});
  });
  
  // logout
  router.post('/logout', checkSession, (req, res, next) => {
    user_id = req.body.user_id;
    key_session = 'user:' + user_id + ':session';
    
    // remove session id from database
    redis.DEL(key_session)
    .then((num) => {
      res.json({'success': 'Successful logout'});
    }).catch((err) => {
      next(createError(500, 'Database error'));
    });
  });
  
  router.post('/bought', checkSession, extendSession, (req, res, next) => {
    const user_id = req.body.user_id;
  
    redis.SMEMBERS('user:' + user_id + ':item')
    .then(bids => res.json(bids.map(bid => parseInt(bid))))
    .catch(err => {
      console.log(err);
      next(createError(500, 'Database error'));
    });
  });
  
  router.post('/purchase', checkSession, extendSession, (req, res, next) => {
    if (typeof req.body.order_id !== 'string') {
      console.log('order_id');
      next(createError(400, 'Invalid parameter'));
      return;
    }
    if (typeof req.body.ids === undefined
        || !Array.isArray(req.body.ids)
        || req.body.ids.some(id => typeof id !== 'number' || !Number.isInteger(id))) {
      console.log('ids');
      next(createError(400, 'Invalid parameter'));
      return;
    }
    
    const paypal_id = req.body.order_id;
    const ids = req.body.ids;
    let order_id;
    let price;
    let item_codes;
    let value;
    let sum_size;
  
    redis.SISMEMBER('order:used', paypal_id).then(yes => {
      if (yes === 1) {
        // this order is already used
        return Promise.reject('orderid');
      }
  
      const request = new checkoutsdk.orders.OrdersGetRequest(paypal_id);
  
      return newPaypalClient().execute(request);
    }).then(order => {
      // validate order
      if (order.result.purchase_units[0].amount.currency_code !== 'USD') {
        return Promise.reject('onlyusd');
      }
      if (order.result.status !== 'COMPLETED') {
        return Promise.reject('incomplete');
      }
  
      value = order.result.purchase_units[0].amount.value;
  
      const batches = makeSQLBatch(ids);
  
      return Promise.all(batches.map(batch => {
        const parameters = Array(batch.length).fill('?').join(', ');
  
        return new Promise((resolve, reject) => {
          sqlite.prepare('SELECT sum(raw_size) as sum_size FROM items WHERE id IN (' + parameters + ') ', function(err) {
            if (err)
              reject(err);
            else
              resolve(this);
          });
        }).then(stmt => {
          return new Promise((resolve, reject) => {
            stmt.get(batch, (err, row) => {
              if (err)
                reject(err);
              else
                resolve(row.sum_size);
            });
          });
        });
      })).then(sum_size_arr => {
        return sum_size_arr.reduce((a, b) => a + b, 0);
      });
    }).then(total_sum_size => {
      sum_size = total_sum_size;
      const bigprice = CALC_PRICE(sum_size);
  
      if (bigprice < 500)
        return Promise.reject('toosmall');
  
      const price_str = bigprice.toString();
      price = price_str.slice(0, -2) + '.' + price_str.slice(-2);
  
      if (value !== price)
        return Promise.reject('value');
  
      return randomBytes(32);
    }).then(buf => {
      order_id = base64url(buf);
  
      // add paypal order id so as not to be used again
      return redis.SADD('order:used', paypal_id);
    }).then(count => {
      return redis.SET('order:' + order_id + ':paypal', paypal_id);
    }).then(ok => {
      // generate URLs
      return Promise.all(
        ids.map(id => randomBytes(32).then(buf => base64url(buf)))
      );
    }).then(codes => {
      item_codes = codes;
  
      const request = Array(item_codes.length*2);
      item_codes.forEach((code, i) => {
        request[2*i] = 'itemcode:' + code + ':id';
        request[2*i+1] = ids[i];
      });
  
      return redis.MSET(...request);
    }).then(alwayszero => {
      const request = Array(ids.length*2);
      ids.forEach((id, i) => {
        request[2*i] = id;
        request[2*i+1] = item_codes[i];
      });
  
      return redis.HMSET('order:' + order_id + ':item', ...request);
    }).then(ok => {
      return redis.SET('order:' + order_id + ':size', sum_size)
    }).then(ok => {
      return redis.SET('order:' + order_id + ':date', moment().utc().unix());
    }).then(ok => {
      return redis.SET('order:' + order_id + ':total', price);
    }).then(ok => {
      return redis.LPUSH('user:' + user_id + ':order', order_id);
    }).then(ok => {
      return redis.SADD('user:' + user_id + ':item', ids);
    }).then(count => {
      res.json({ success: true });
    }).catch(err => {
      if (err === 'orderid') {
        console.error('Order id already used', paypal_id);
        next(createError(400, 'Order id already used'));
      } else if (err === 'onlyusd') {
        console.log('Only accepts USD', paypal_id);
        next(createError(400, 'Only USD is accepted'));
      } else if (err === 'toosmall') {
        console.log('Total is too small');
        next(createError(400, 'Total is too small'));
      } else if (err === 'incomplete') {
        console.log('Not complete', paypal_id);
        next(createError(400, 'Order is not complete'));
      } else if (err === 'value') {
        console.log(paypal_id);
        next(createError(400, 'Payment value mismatch'));
      } else {
        console.log(err, paypal_id);
        next(createError(500, 'Communication error'));
      }
    });
  });
  
  router.post('/listorder', checkSession, extendSession, (req, res, next) => {
    const user_id = req.body.user_id;
  
    redis.LRANGE('user:' + user_id + ':order', 0, -1).then(order_ids => {
      if (order_ids === null)
        order_ids = [];
      res.json(order_ids);
    }).catch(err => {
      console.log(err);
      next(createError(500, 'Database error'));    
    });
  });

  return router;
};