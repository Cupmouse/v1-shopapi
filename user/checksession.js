const createError = require('http-errors');

module.exports = redis => {
  return (req, res, next) => {
    const user_id = req.body.user_id;
    const session_id = req.body.session_id;

    // check if parameters client given is valid
    if (typeof user_id !== 'string' || typeof session_id !== 'string') {
      next(createError(400, 'Invalid parameters'));
      return;
    }

    // check if session id client provided actually exist 
    key_session = 'user:' + user_id + ':session';

    redis.GET(key_session)
    .then((stored) => {
      if (stored === session_id) {
        // session id matched, great!
        next();
      } else {
        // wrong session id
        redis.DEL(key_session).then((num) => next(createError(401, 'You are not logged in')));
      }
    }).catch((err) => {
      console.log(err);
      next(createError(500, 'Database error'));
    });
  };
};