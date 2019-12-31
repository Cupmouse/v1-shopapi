const createError = require('http-errors')
const request = require('request')

const { RECAPTCHA_URL, RECAPTCHA_SECRET } = require('../common')

exports.checkCaptcha = (req, res, next) => {
  if (typeof req.body === 'undefined' || typeof req.body.token !== 'string') {
    next(createError(400, 'Invalid parameters'))
    return
  }

  const token = req.body.token

  request.post(RECAPTCHA_URL, {
    headers: {
      'content-type': 'application/x-www-form-urlencoded'
    },
    form: {
      secret: RECAPTCHA_SECRET,
      response: token
    }
  }, (error, response, body) => {
    if (error) {
      next(createError(400, 'ReCaptcha verification failed'))
      return
    }

    body = JSON.parse(body)

    if (typeof body.success !== 'undefined' && !body.success) {
      next(createError(400, 'ReCaptcha verification failed'))
    } else {
      next()
    }
  })
}
