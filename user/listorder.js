const createError = require('http-errors');

module.exports = redis => {
  return (req, res, next) => {
    const user_id = req.body.user_id;

    redis.LRANGE('user:' + user_id + ':order', 0, -1).then(order_ids => {
      if (order_ids === null)
        order_ids = [];
      res.json(order_ids);
    }).catch(err => {
      console.log(err);
      next(createError(500, 'Database error'));    
    });
  };
};