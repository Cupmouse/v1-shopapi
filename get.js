const express = require('express');
const createError = require('http-errors');

const { DOWNLOAD_LIMIT, DATA_PATH } = require('./common');

module.exports = (redis, sqlite) => {
  const router = express.Router();

  router.get('*', (req, res, next) => {
    if (typeof req.query.code !== 'string') {
      next(createError(400, 'Invalid parameter'));
      return;
    }
  
    const item_code = req.query.code;
    let item_id;
  
    redis.GET('itemcode:' + item_code + ':id').then(id => {
      if (id === null)
        return Promise.reject('invalid');
      
      item_id = id;
  
      return redis.GET('itemcode:' + item_code + ':count');
    }).then(count => {
      if (count >= DOWNLOAD_LIMIT)
        return Promise.reject('limit');
  
      return redis.INCR('itemcode:' + item_code + ':count');
    }).then(incr => {
      return new Promise((resolve, reject) => {
        sqlite.prepare('SELECT name FROM items WHERE id = ?', function(err) {
          if (err)
            reject(err)
          else
            resolve(this);
        });
      });
    }).then(stmt => {
      return new Promise((resolve, reject) => {
        stmt.get(item_id, (err, row) => {
          if (err)
            reject(err);
          else
            resolve(row);
        });
      });
    }).then(row => {
      const name = row.name;
      const path = DATA_PATH + name + '.gz';
  
      res.download(path);
    }).catch(err => {
      if (err === 'invalid') {
        console.log('Invalid code');
        next(createError(400, 'Invalid code'));
      } else if (err === 'limit') {
        console.log('limit');
        next(createError(400, 'Item download limit reached'));
      } else {
        console.log(err);
        next(createError(500, 'Database error'));
      }
    });
  });

  return router;
}