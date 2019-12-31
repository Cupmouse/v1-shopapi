const createError = require('http-errors')

module.exports = redis => {
  return (req, res, next) => {
    const userId = req.body.user_id

    redis.LRANGE('user:' + userId + ':order', 0, -1).then(orderIds => {
      if (orderIds === null) {
        orderIds = []
      }
      res.json(orderIds)
    }).catch(err => {
      console.log(err)
      next(createError(500, 'Database error'))
    })
  }
}
