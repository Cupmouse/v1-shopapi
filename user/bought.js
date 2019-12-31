module.exports = redis => {
  return (req, res, next) => {
    const userId = req.body.user_id

    redis.SMEMBERS('user:' + userId + ':item')
      .then(bids => res.json(bids.map(bid => parseInt(bid))))
      .catch(err => {
        next(err)
      })
  }
}
