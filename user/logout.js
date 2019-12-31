const createError = require('http-errors');

module.exports = redis => {
  return (req, res, next) => {
    const user_id = req.body.user_id;
    const key_session = 'user:' + user_id + ':session';
    
    // remove session id from database
    redis.DEL(key_session)
    .then((num) => {
      res.json({'success': 'Successful logout'});
    }).catch((err) => {
      next(createError(500, 'Database error'));
    });
  };
};