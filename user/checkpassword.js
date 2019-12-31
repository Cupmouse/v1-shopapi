const createError = require('http-errors')

module.exports = (req, res, next) => {
  if (typeof req.body === 'undefined' || typeof req.body.user_id !== 'string' || typeof req.body.password !== 'string') {
    // an access will be denied
    next(createError(400, 'Invalid parameters'))
  } else if (req.body.user_id.length < 3 || req.body.password.length < 5) {
    next(createError(400, 'Invalid parameters'))
  } else {
    next()
  }
}
