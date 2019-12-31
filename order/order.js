const createError = require('http-errors')

const { makeSQLBatch } = require('../utils/sqlite')

module.exports = (redis, sqlite) => {
  return (req, res, next) => {
    if (typeof req.body.order_id !== 'string') {
      next(createError(400, 'Invalid parameter'))
      return
    }

    const orderId = req.body.order_id
    const idvcodes = {}
    let ids
    let items
    let date
    let total
    let sumSize

    redis.HGETALL('order:' + orderId + ':item').then(hgetall => {
      if (hgetall === null) {
        throw createError(400, 'Unknown order ID')
      }

      Object.entries(hgetall).forEach(entry => {
        idvcodes[parseInt(entry[0])] = entry[1]
      })

      ids = Object.keys(idvcodes)

      const batches = makeSQLBatch(ids)

      return Promise.all(batches.map(batch => {
        return new Promise((resolve, reject) => {
          const sql = 'SELECT id, name, raw_size FROM items WHERE id IN (' + Array(batch.length).fill('?').join(', ') + ')'

          sqlite.prepare(sql, function (err) {
            if (err) {
              this.finalize()
              reject(err)
            } else {
              resolve(this)
            }
          })
        }).then(stmt => {
          return new Promise((resolve, reject) => {
            stmt.all(batch, (err, rows) => {
              stmt.finalize()
              if (err) {
                reject(err)
              } else {
                resolve(rows)
              }
            })
          })
        })
      })).then(rowsArray => rowsArray.flat(1))
    }).then(rows => {
      items = rows

      const request = Array(idvcodes.length)
      // set code for response
      items.forEach((item, i) => {
        const code = idvcodes[item.id]
        item.code = code
        request[i] = 'itemcode:' + code + ':count'
      })

      return redis.MGET(...request)
    }).then(counts => {
      items.forEach((item, i) => {
        item.count = counts[i] === null ? 0 : counts[i]
      })

      return redis.GET('order:' + orderId + ':size')
    }).then(get => {
      sumSize = get

      return redis.GET('order:' + orderId + ':date')
    }).then(get => {
      date = get

      return redis.GET('order:' + orderId + ':total')
    }).then(get => {
      total = get

      res.json({
        items,
        date,
        sum_size: sumSize,
        total
      })
    }).catch(err => {
      next(err)
    })
  }
}
