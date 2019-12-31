const createError = require('http-errors')

const bcrypt = require('bcrypt')

const { SALT_ROUNDS } = require('../common')

module.exports = redis => {
  return (req, res, next) => {
    const userId = req.body.user_id
    const password = req.body.password

    const keyPassword = 'user:' + userId + ':password'

    bcrypt.hash(password, SALT_ROUNDS)
      .then(hashed => redis.SETNX(keyPassword, hashed))
      .then(set => {
        if (set === 1) {
        // user created
          res.json({
            success: 'User created'
          })
        } else {
          next(createError(401, 'User with id "' + userId + '" already exists'))
        }
      }).catch((err) => {
        console.log(err)
        next(createError(500, 'Internal error'))
      })
  }
}
