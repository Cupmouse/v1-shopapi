const createError = require('http-errors');

const bcrypt = require('bcrypt');

const { SESSION_TIME, LENGTH_SESSION_ID } = require('../common');
const { randomBytes } = require('../utils/promisified');

module.exports = redis => {
  return (req, res, next) => {
    const user_id = req.body.user_id;
    const password = req.body.password;
  
    const key_session = 'user:' + user_id + ':session';
    const key_password = 'user:' + user_id + ':password';
  
    let session_id = null;
  
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
  };
};