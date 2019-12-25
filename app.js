const createError = require('http-errors');
const express = require('express');
const logger = require('morgan');
const helmet = require('helmet');
const redis = require('redis');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const util = require('util');
const sqlite3 = require('sqlite3');
const request = require('request');

const app = express();

app.use(logger('dev'));
app.use(express.json());
// app.use(express.urlencoded({ extended: false }));
app.use(helmet());

const SALT_ROUNDS = 13;
const LENGTH_SESSION_ID = 64;
const SESSION_TIME = 30 * 60 * 1000; // 30 minutes
const NUL_LIMIT = 10;
const SQL_PRICE = (col,as) => 'CAST(3*100*CAST(' + col + ' AS REAL)/1024/1024/1024 AS INTEGER) AS ' + as;
const PRICE = 3n;
const CALC_PRICE = (raw_size) => {
  const sum = BigInt(raw_size);

  return Number(sum * PRICE * 100n / 1073741824n);
};
const PATH_DATA_DB = './items.db';

const redcli = redis.createClient();
const redisGet = util.promisify(redcli.GET).bind(redcli);
const redisSet = util.promisify(redcli.SET).bind(redcli);
const redisSetnx = util.promisify(redcli.SETNX).bind(redcli);
const redisDel = util.promisify(redcli.DEL).bind(redcli);
const redisPexpire = util.promisify(redcli.PEXPIRE).bind(redcli);

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

  sqlite.prepare('SELECT count(*) AS count FROM items' + where, function(err) {
    if (err) {
      console.log(err);
      next(createError(500, 'Database error'));
      return;
    }

    this.get(params, (err, get_res) => {
      if (err) {
        console.log(err);
        next(createError(500, 'Database error'));
        this.finalize();
        return;
      }
      const count = get_res['count'];
      this.finalize();

      const num_pages = Math.max(Math.ceil(count/NUL_LIMIT), 1);

      if (typeof req.body.page !== 'undefined' && typeof req.body.page === 'number' && Number.isInteger(req.body.page) && 1 <= req.body.page) {
        params.push(NUL_LIMIT*(req.body.page-1));
      } else {
        params.push(0);
      }

      const sql = 'SELECT id, exchange, pairs, date_start, date_end, raw_size, '
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

app.post('/getitem', function(req, res, next) {
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

  const secretKey = '6LfFackUAAAAALRDhZuVX0bPMsZR3oDpw1qru7gh';
  const token = req.body.token;
  const recaptcha_url = 'https://www.google.com/recaptcha/api/siteverify';
  
  request.post(recaptcha_url, {
    headers: {'content-type' : 'application/x-www-form-urlencoded'},
    form: {
      secret: secretKey,
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

  const key_password = 'password#'+user_id;

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

  const key_session = 'session#'+user_id;
  const key_password = 'password#'+user_id;

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
  key_session = 'session#' + user_id;

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
  key_session = 'session#' + user_id;

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
  key_session = 'session#' + user_id;
  
  // remove session id from database
  redisDel(key_session)
  .then((num) => {
    res.json({'success': 'Successful logout'});
  }).catch((err) => {
    next(createError(500, 'Database error'));
  });
});

// get data
app.post('/get', checkSession, extendSession, function(req, res, next) {
  if (req.params.hasOwnProperty('name')) {
    filename = req.params['name'];
    res.setHeader('content-type', 'application/gzip');
    fs.createReadStream(filename).pipe(res);
  } else {
    next(createError(400, 'Malformed request'));
  }
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
  
  res.status(err.statusCode).json({'error': err.message});
});

module.exports = app;
