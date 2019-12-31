const createError = require('http-errors');

const bcrypt = require('bcrypt');

const { SALT_ROUNDS } = require('../common');

module.exports = redis => {
  return (req, res, next) => {
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
  };
};