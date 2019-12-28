const SALT_ROUNDS = 13;
const LENGTH_SESSION_ID = 64;
const SESSION_TIME = 3 * 60 * 60 * 1000; // 3 hours
const NUL_LIMIT = 10;
const SQL_PRICE = (col,as) => 'CAST(3*100*CAST(' + col + ' AS REAL)/1024/1024/1024 AS INTEGER) AS ' + as;
const PRICE = 3n;
const CALC_PRICE = (raw_size) => {
  const sum = BigInt(raw_size);

  return Number(sum * PRICE * 100n / 1073741824n);
};
const PATH_DATA_DB = './items.db';
const PAYPAL_ID = 'ATdZPSLf61TWnm1v7iYfTvVY0BtoitHdKxjZBHmUZmAXPZyp5U2x3KUCNoYn0d65eTzOCkRvSqotyv2z';
const PAYPAL_SECRET = 'EG7pocZM097wbmqNIdvBYtNqKf56YWSOU46kAPededPajJ_BURphY7AnRrnI_jfV4B-1dXjFxHdb7mLn';
const DATA_PATH = '/home/shimaoka/data/items/bitflyer/'
const DOWNLOAD_LIMIT = 3;
const RECAPTCHA_SECRET = '6LfFackUAAAAALRDhZuVX0bPMsZR3oDpw1qru7gh';
const RECAPTCHA_URL = 'https://www.google.com/recaptcha/api/siteverify';

const createError = require('http-errors');
const express = require('express');
const logger = require('morgan');
const helmet = require('helmet');
const cors = require('cors')
const redis = require('redis');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const util = require('util');
const sqlite3 = require('sqlite3');
const request = require('request');
const fs = require('fs');
const zlib = require('zlib');
const readline = require('readline');
const base64url = require('base64url');
const moment = require('moment');
const checkoutNodeJssdk = require('@paypal/checkout-server-sdk');
const payPalClient = () => {
  return new checkoutNodeJssdk.core.PayPalHttpClient(
    new checkoutNodeJssdk.core.SandboxEnvironment(PAYPAL_ID, PAYPAL_SECRET)
  );
};
const cors_option = {
  origin: 'http://localhost:3000',
};
const app = express();

app.use(logger('dev'));
app.use(cors(cors_option))
app.use(express.json());
// app.use(express.urlencoded({ extended: false }));
app.use(helmet());

const redcli = redis.createClient();
const redisGet = util.promisify(redcli.GET).bind(redcli);
const redisSet = util.promisify(redcli.SET).bind(redcli);
const redisMset = util.promisify(redcli.MSET).bind(redcli);
const redisMget = util.promisify(redcli.MGET).bind(redcli);
const redisIncr = util.promisify(redcli.INCR).bind(redcli);
const redisSetnx = util.promisify(redcli.SETNX).bind(redcli);
const redisDel = util.promisify(redcli.DEL).bind(redcli);
const redisPexpire = util.promisify(redcli.PEXPIRE).bind(redcli);
const redisSadd = util.promisify(redcli.SADD).bind(redcli);
const redisSmembers = util.promisify(redcli.SMEMBERS).bind(redcli);
const redisSismember = util.promisify(redcli.SISMEMBER).bind(redcli);
const redisHmset = util.promisify(redcli.HMSET).bind(redcli);
const redisHgetall = util.promisify(redcli.HGETALL).bind(redcli);
const redisLpush = util.promisify(redcli.LPUSH).bind(redcli);
const redisLrange = util.promisify(redcli.LRANGE).bind(redcli);

const sqlite = new sqlite3.Database(PATH_DATA_DB);
const sqlitePrepare = util.promisify(sqlite.prepare).bind(sqlite);

const randomBytes = util.promisify(crypto.randomBytes).bind(crypto);


app.post('/search', function(req, res, next) {
  let constrains = [];
  let params = [];
  if (typeof req.body.exchanges !== 'undefined' && Array.isArray(req.body.exchanges)) {
    let sql_or = [];
    req.body.exchanges.forEach(exchange => {
      if (typeof exchange === 'string') {
        sql_or.push('exchange = ?');
        params.push(exchange);
      }
    });
    constrains.push('(' + sql_or.join(' OR ') + ')');
  }
  if (typeof req.body.pairs !== 'undefined' && Array.isArray(req.body.pairs)) {
    let sql_or = [];
    req.body.pairs.forEach(pair => {
      if (typeof pair === 'string') {
        sql_or.push('pairs LIKE ? ESCAPE "\\"');
        const sanitized = pair.replace('%', '\\%').replace('_', '\\_');
        params.push('%' + sanitized + '%');
      }
    });
    constrains.push('(' + sql_or.join(' AND ') + ')');
  }
  if (typeof req.body.date_start !== 'undefined' && typeof req.body.date_start === 'number' && Number.isInteger(req.body.date_start)) {
    constrains.push('date_end >= ?');
    params.push(req.body.date_start);
  }

  if (typeof req.body.date_end !== 'undefined' && typeof req.body.date_end === 'number' && Number.isInteger(req.body.date_end)) {
    constrains.push('date_start <= ?');
    params.push(req.body.date_end);
  }

  let where = '';
  if (params.length > 0) {
    where = ' WHERE ' + constrains.join(' AND ');
  }

  sqlite.prepare('SELECT id FROM items' + where, function(err) {
    if (err) {
      console.log(err);
      next(createError(500, 'Database error'));
      return;
    }

    this.all(params, (err, rows) => {
      if (err) {
        console.log(err);
        next(createError(500, 'Database error'));
        this.finalize();
        return;
      }
      const ids = rows.map(row => row.id);
      this.finalize();

      const num_pages = Math.max(Math.ceil(ids.length/NUL_LIMIT), 1);

      if (typeof req.body.page !== 'undefined' && typeof req.body.page === 'number' && Number.isInteger(req.body.page) && 1 <= req.body.page) {
        params.push(NUL_LIMIT*(req.body.page-1));
      } else {
        params.push(0);
      }

      const sql = 'SELECT id, name, exchange, pairs, date_start, date_end, raw_size, '
        + SQL_PRICE('raw_size', 'price') + ' FROM items'
        + where + ' ORDER BY date_start DESC LIMIT ' + NUL_LIMIT + ' OFFSET ?';

      sqlite.prepare(sql, function (err) {
        if (err) {
          console.log(err);
          next(createError(500, 'Database error'));
          return;
        }

        this.all(params, (err, rows) => {
          if (err) {
            console.log(err);
            next(createError(500, 'Database error'));
          } else {
            res.json({
              ids: ids,
              items: rows,
              num_page: num_pages,
            });
          }
          this.finalize();
        });
      });
    });
  });
});

app.post('/cart', function(req, res, next) {
  if (typeof req.body !== 'undefined' && Array.isArray(req.body)) {
    const ids = req.body;

    const parameters = Array(ids.length).fill('?').join(', ');

    const sql = 'SELECT id, name, raw_size FROM items WHERE id IN (' + parameters + ') '
      + 'UNION SELECT -1, "", sum(raw_size) FROM items WHERE id IN (' + parameters + ') ';

    sqlite.prepare(sql, function(err) {
      if (err) {
        console.log(err);
        next(createError(500, 'Database error'));
        return;
      }

      this.all(ids.concat(ids), (err, rows) => {
        if (err) {
          console.log(err);
          next(createError(500, 'Database error'));
          return;
        }

        const sum_size = rows[0].raw_size === null ? 0 : rows[0].raw_size;
        res.json({
          items: rows.slice(1),
          sum_size: sum_size,
          sum_price: CALC_PRICE(sum_size),
        });
      });
    });
  } else {
    res.json({
      items: [],
      sum_size: 0,
      sum_price: 0,
    });
  }
});

app.post('/sample', function(req, res, next) {
  if (req.body === undefined || typeof req.body.id !== 'number' || !Number.isInteger(req.body.id)) {
    next(createError(400, 'Invalid parameters'));
    return;
  }

  const id = req.body.id;

  new Promise((resolve, reject) => {
    sqlite.prepare('SELECT name FROM items WHERE id = ?', function (err) {
      if (err)
        reject(err);
      else
        resolve(this);
    });
  }).then(stmt => {
    return new Promise((resolve, reject) => {
      stmt.get(id, function (err, row) {
        if (err)
          reject(err);
        else
          resolve(row);
      });
    });
  }).then(row => {
    if (row === undefined)
      return Promise.reject('id');
    
    const name = row.name;
    const path = DATA_PATH + name + '.gz';

    const lineReader = readline.createInterface({
      input: fs.createReadStream(path).pipe(zlib.createGunzip()),
    });

    let n = 0;
    let text = '';

    return new Promise((resolve, reject) => {
      lineReader.on('line', (line) => {
        text += line + '\n';
        if (n >= 1000) {
          lineReader.close();
          resolve(text);
        }
        n += 1;
      });
      lineReader.on('end', () => {
        lineReader.close();
        resolve(text);
      });
    });
  }).then(text => {
    res.setHeader('content-type', 'text/plain');
    res.send(text);
  }).catch(err => {
    if (err === 'id') {
      next(createError(400, 'Database with id not found'));
    } else {
      console.log(err);
      next(createError(500, 'Database error'));
    }
  });
});


// get data
app.get('/get', function(req, res, next) {
  if (typeof req.query.code !== 'string') {
    next(createError(400, 'Invalid parameter'));
    return;
  }

  const item_code = req.query.code;
  let item_id;

  redisGet('itemcode:' + item_code + ':id').then(id => {
    if (id === null)
      return Promise.reject('invalid');
    
    item_id = id;

    return redisGet('itemcode:' + item_code + ':count');
  }).then(count => {
    if (count >= DOWNLOAD_LIMIT)
      return Promise.reject('limit');

    return redisIncr('itemcode:' + item_code + ':count');
  }).then(incr => {
    return new Promise((resolve, reject) => {
      sqlite.prepare('SELECT name FROM items WHERE id = ?', function(err) {
        if (err)
          reject(err)
        else
          resolve(this);
      });
    });
  }).then(stmt => {
    return new Promise((resolve, reject) => {
      stmt.get(item_id, (err, row) => {
        if (err)
          reject(err);
        else
          resolve(row);
      });
    });
  }).then((row) => {
    const name = row.name;
    const path = DATA_PATH + name + '.gz';

    res.download(path);
  }).catch(err => {
    if (err === 'invalid') {
      console.log('Invalid code');
      next(createError(400, 'Invalid code'));
    } else if (err === 'limit') {
      console.log('limit');
      next(createError(400, 'Item download limit reached'));
    } else {
      console.log(err);
      next(createError(500, 'Database error'));
    }
  });
});

checkPassword = function(req, res, next) {
  if (typeof req.body === 'undefined' || typeof req.body.user_id !== 'string' || typeof req.body.password !== 'string') {
    // an access will be denied
    next(createError(400, 'Invalid parameters'));
  } else if (req.body.user_id.length < 3 || req.body.password.length < 5) {
    next(createError(400, 'Invalid parameters'));
  } else {
    next();
  }
};

checkCaptcha = function(req, res, next) {
  if (typeof req.body === 'undefined' || typeof req.body.token !== 'string') {
    next(createError(400, 'Invalid parameters'));
    return;
  }

  const token = req.body.token;
  
  request.post(RECAPTCHA_URL, {
    headers: {'content-type' : 'application/x-www-form-urlencoded'},
    form: {
      secret: RECAPTCHA_SECRET,
      response: token,
    },
  }, function(error, response, body) {
    if (error) {
      next(createError(400, 'ReCaptcha verification failed'));
      return;
    }

    body = JSON.parse(body);

    if(typeof body.success !== 'undefined' && !body.success) {
      next(createError(400, 'ReCaptcha verification failed'));
    } else {
      next();
    }
  });
};

app.post('/signup', checkPassword, checkCaptcha, function(req, res, next) {
  const user_id = req.body.user_id;
  const password = req.body.password;

  const key_password = 'user:' + user_id + ':password';

  bcrypt.hash(password, SALT_ROUNDS)
  .then((hashed) => redisSetnx(key_password, hashed))
  .then((set) => {
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
app.post('/login', checkPassword, checkCaptcha, function(req, res, next) {
  const user_id = req.body.user_id;
  const password = req.body.password;

  const key_session = 'user:' + user_id + ':session';
  const key_password = 'user:' + user_id + ':password';

  session_id = null;

  redisGet(key_password)
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

    return redisSet(key_session, session_id);
  }).then((result) => {
    if (result === 'OK') {
      // set default expiery time
      return redisPexpire(key_session, SESSION_TIME);
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
checkSession = function(req, res, next) {
  user_id = req.body.user_id;
  session_id = req.body.session_id;

  // check if parameters client given is valid
  if (typeof user_id !== 'string' || typeof session_id !== 'string') {
    next(createError(400, 'Invalid parameters'));
    return;
  }

  // check if session id client provided actually exist 
  key_session = 'user:' + user_id + ':session';

  redisGet(key_session)
  .then((stored) => {
    if (stored === session_id) {
      // session id matched, great!
      next();
    } else {
      // wrong session id
      redisDel(key_session).then((num) => next(createError(401, 'You are not logged in')));
    }
  }).catch((err) => {
    console.log(err);
    next(createError(500, 'Database error'));
  });
};

extendSession = function(req, res, next) {
  key_session = 'user:' + user_id + ':session';

  // make session time longer
  redisPexpire(key_session, SESSION_TIME)
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

app.post('/isloggedin', checkSession, function(req, res, next) {
  res.json({'status': true});
});

// logout
app.post('/logout', checkSession, function(req, res, next) {
  user_id = req.body.user_id;
  key_session = 'user:' + user_id + ':session';
  
  // remove session id from database
  redisDel(key_session)
  .then((num) => {
    res.json({'success': 'Successful logout'});
  }).catch((err) => {
    next(createError(500, 'Database error'));
  });
});

app.post('/bought', checkSession, extendSession, function(req, res, next) {
  const user_id = req.body.user_id;

  redisSmembers('user:' + user_id + ':item')
  .then(bids => res.json(bids.map(bid => parseInt(bid))))
  .catch(err => {
    console.log(err);
    next(createError(500, 'Database error'));
  });
});

app.post('/purchase', checkSession, extendSession, function(req, res, next) {
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

  redisSismember('order:used', paypal_id).then(yes => {
    if (yes === 1) {
      // this order is already used
      return Promise.reject('orderid');
    }

    const request = new checkoutNodeJssdk.orders.OrdersGetRequest(paypal_id);

    return payPalClient().execute(request);
  }).then(order => {
    // validate order
    if (order.result.purchase_units[0].amount.currency_code !== 'USD') {
      return Promise.reject('onlyusd');
    }
    if (order.result.status !== 'COMPLETED') {
      return Promise.reject('incomplete');
    }

    value = order.result.purchase_units[0].amount.value;

    const parameters = Array(ids.length).fill('?').join(', ');

    return new Promise((resolve, reject) => {
      sqlite.prepare('SELECT sum(raw_size) as sum_size FROM items WHERE id IN (' + parameters + ') ', function(err) {
        if (err)
          reject(err);
        else
          resolve(this);
      });
    });
  }).then(stmt => {
    return new Promise((resolve, reject) => {
      stmt.get(ids, (err, row) => {
        if (err)
          reject(err);
        else
          resolve(row);
      });
    });
  }).then(row => {
    sum_size = row.sum_size;
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
    return redisSadd('order:used', paypal_id);
  }).then(count => {
    return redisSet('order:' + order_id + ':paypal', paypal_id);
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

    return redisMset(...request);
  }).then(alwayszero => {
    const request = Array(ids.length*2);
    ids.forEach((id, i) => {
      request[2*i] = id;
      request[2*i+1] = item_codes[i];
    });

    return redisHmset('order:' + order_id + ':item', ...request);
  }).then(ok => {
    return redisSet('order:' + order_id + ':size', sum_size)
  }).then(ok => {
    return redisSet('order:' + order_id + ':date', moment().utc().unix());
  }).then(ok => {
    return redisSet('order:' + order_id + ':total', price);
  }).then(ok => {
    return redisLpush('user:' + user_id + ':order', order_id);
  }).then(ok => {
    return redisSadd('user:' + user_id + ':item', ids);
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

app.post('/listorder', checkSession, extendSession, function(req, res, next) {
  const user_id = req.body.user_id;

  redisLrange('user:' + user_id + ':order', 0, -1).then(order_ids => {
    if (order_ids === null)
      order_ids = [];
    res.json(order_ids);
  }).catch(err => {
    console.log(err);
    next(createError(500, 'Database error'));    
  });
});

app.post('/order', checkSession, extendSession, function(req, res, next) {
  if (typeof req.body.order_id !== 'string') {
    next(createError(400, 'Invalid parameter'));
    return;
  }

  const order_id = req.body.order_id;
  let idvcodes = {};
  let ids;
  let items;
  let date;
  let total;
  let sum_size;

  redisHgetall('order:' + order_id + ':item').then(hgetall => {
    if (hgetall === null)
      return Promise.reject('invalid');

    Object.entries(hgetall).forEach(entry => {
      idvcodes[parseInt(entry[0])] = entry[1];
    });

    ids = Object.keys(idvcodes);

    return new Promise((resolve, reject) => {
      const sql = 'SELECT id, name, raw_size FROM items WHERE id IN (' + Array(ids.length).fill('?').join(', ') + ')';

      sqlite.prepare(sql, function(err) {
        if (err)
          reject(err);
        else
          resolve(this);
      });
    });
  }).then(stmt => {
    return new Promise((resolve, reject) => {
      stmt.all(ids, (err, rows) => {
        if (err)
          reject(err);
        else
          resolve(rows);
      });
    });
  }).then(rows => {
    items = rows;

    const request = Array(idvcodes.length);
    // set code for response
    items.forEach((item, i) => {
      const code = idvcodes[item.id];
      item.code = code;
      request[i] = 'itemcode:' + code + ':count';
    });

    return redisMget(...request);
  }).then(counts => {
    items.forEach((item, i) => {
      item.count = counts[i] === null ? 0 : counts[i];
    });
    
    return redisGet('order:' + order_id + ':size');
  }).then(get => {
    sum_size = get;

    return redisGet('order:' + order_id + ':date');
  }).then(get => {
    date = get;

    return redisGet('order:' + order_id + ':total');
  }).then(get => {
    total = get;

    res.json({
      items,
      date,
      sum_size,
      total,
    });
  }).catch(err => {
    if (err === 'invalid') {
      next(createError(400, 'Order not exist'));
    } else {
      console.log(err);
      next(createError(500, 'Database error'));
    }
  });
});

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404, 'Resource not found'));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};
  
  const statusCode = err.statusCode === undefined ? 500 : err.statusCode;
  res.status(statusCode).json({error: err.message});
});

module.exports = app;
