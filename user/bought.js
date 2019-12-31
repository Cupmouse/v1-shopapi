const createError = require('http-errors');

module.exports = redis => {
  return (req, res, next) => {
    const user_id = req.body.user_id;

    redis.SMEMBERS('user:' + user_id + ':item')
    .then(bids => res.json(bids.map(bid => parseInt(bid))))
    .catch(err => {
      console.log(err);
      next(createError(500, 'Database error'));
    });
  };
};