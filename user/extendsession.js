const createError = require('http-errors');
const { SESSION_TIME } = require('../common');

module.exports = redis => {
  return (req, res, next) => {
    const user_id = req.body.user_id;
    const key_session = 'user:' + user_id + ':session';

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
};