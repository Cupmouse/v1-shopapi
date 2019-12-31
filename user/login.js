const createError = require('http-errors')

const bcrypt = require('bcrypt')

const { SESSION_TIME, LENGTH_SESSION_ID, IllegalInputError } = require('../common')
const { randomBytes } = require('../utils/promisified')

module.exports = redis => {
  return (req, res, next) => {
    const userId = req.body.user_id
    const password = req.body.password

    const keySession = 'user:' + userId + ':session'
    const keyPassword = 'user:' + userId + ':password'

    let sessionId = null

    redis.GET(keyPassword)
      .then(stored => {
        if (stored == null) {
          throw createError(400, 'Authentication error: user id or password is incorrect')
        } else {
          return bcrypt.compare(password, stored)
        }
      }).then(isCorrect => {
        if (isCorrect) {
        // generate new session id
          return randomBytes(LENGTH_SESSION_ID)
        } else {
        // failed login
          throw IllegalInputError(400, 'Authentication error: user id or password is incorrect')
        }
      }).then(bytes => {
        sessionId = bytes.toString('hex')

        return redis.SET(keySession, sessionId)
      }).then(result => {
        if (result === 'OK') {
        // set default expiery time
          return redis.PEXPIRE(keySession, SESSION_TIME)
        } else {
          throw Error('SET failed')
        }
      }).then(timeout => {
      // all procedure done, login ok
        if (timeout === 1) {
          res.json({
            success: 'Successful login',
            session_id: sessionId
          })
        } else {
          throw Error('PEXPIRE failed')
        }
      }).catch(err => {
        // catched exception while autheticating
        next(err)
      })
  }
}
