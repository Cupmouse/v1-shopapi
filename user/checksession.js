const createError = require('http-errors')

module.exports = redis => {
  return (req, res, next) => {
    const userId = req.body.user_id
    const sessionId = req.body.session_id

    // check if parameters client given is valid
    if (typeof userId !== 'string' || typeof sessionId !== 'string') {
      next(createError(400, 'Invalid parameters'))
      return
    }

    // check if session id client provided actually exist
    const keySession = 'user:' + userId + ':session'

    redis.GET(keySession)
      .then(stored => {
        if (stored === sessionId) {
        // session id matched, great!
          next()
        } else {
        // wrong session id
          redis.DEL(keySession).then((num) => next(createError(401, 'You are not logged in')))
        }
      }).catch(err => {
        next(err)
      })
  }
}
