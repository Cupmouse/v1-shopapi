const createError = require('http-errors')
const { SESSION_TIME } = require('../common')

module.exports = redis => {
  return (req, res, next) => {
    const userId = req.body.user_id
    const keySession = 'user:' + userId + ':session'

    // make session time longer
    redis.PEXPIRE(keySession, SESSION_TIME)
      .then(timeout => {
        if (timeout === 1) {
          next()
        } else {
          throw Error('PEXPIRE failed')
        }
      }).catch(err => {
        console.log(err)
        next(createError(500, 'Internal error'))
      })
  }
}
