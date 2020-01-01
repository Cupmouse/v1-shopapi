const express = require('express')
const createError = require('http-errors')

const { DOWNLOAD_LIMIT, DATA_PATH } = require('./common')

module.exports = (redis, sqlite) => {
  const router = express.Router()

  router.get('*', (req, res, next) => {
    if (typeof req.query.code !== 'string') {
      next(createError(400, 'Invalid parameter'))
      return
    }

    const itemCode = req.query.code
    let itemId

    redis.GET('itemcode:' + itemCode + ':id').then(id => {
      if (id === null) {
        throw createError(400, 'Invalid code')
      }

      itemId = id

      return redis.GET('itemcode:' + itemCode + ':count')
    }).then(count => {
      if (count >= DOWNLOAD_LIMIT) {
        throw createError(400, 'Item download limit reached')
      }

      return redis.INCR('itemcode:' + itemCode + ':count')
    }).then(incr => {
      return new Promise((resolve, reject) => {
        sqlite.prepare('SELECT name FROM items WHERE id = ?', function (err) {
          if (err) {
            reject(err)
          } else {
            resolve(this)
          }
        })
      })
    }).then(stmt => {
      return new Promise((resolve, reject) => {
        stmt.get(itemId, (err, row) => {
          if (err) {
            reject(err)
          } else {
            resolve(row)
          }
        })
      })
    }).then(row => {
      const name = row.name
      const path = DATA_PATH + name + '.gz'

      return new Promise((resolve, reject) => {
        res.download(path, err => {
          if (err) {
            reject(err)
          } else {
            resolve()
          }
        })
      })
    }).catch(err => {
      next(err)
    })
  })

  return router
}
