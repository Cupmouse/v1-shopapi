const { CALC_PRICE } = require('../common')
const { makeSQLBatch } = require('../utils/sqlite')

module.exports = sqlite => {
  return (req, res, next) => {
    if (req.body === undefined ||
      !Array.isArray(req.body) ||
      req.body.some(id => typeof id !== 'number' || !Number.isInteger(id))) {
      res.json({
        items: [],
        sum_size: 0,
        sum_price: 0
      })
      return
    }

    const ids = req.body
    const batches = makeSQLBatch(ids)

    // split sql query into batch
    Promise.all(batches.map(batch => {
      const parameters = Array(batch.length).fill('?').join(', ')

      const sql = 'SELECT id, name, raw_size FROM items WHERE id IN (' + parameters + ') ' +
        'UNION SELECT -1, "", sum(raw_size) FROM items WHERE id IN (' + parameters + ') '

      return new Promise((resolve, reject) => {
        sqlite.prepare(sql, function (err) {
          if (err) {
            reject(err)
          } else {
            resolve(this)
          }
        })
      }).then(stmt => {
        return new Promise((resolve, reject) => {
          stmt.all(batch.concat(batch), (err, rows) => {
            if (err) {
              reject(err)
            } else {
              resolve(rows)
            }
          })
        })
      }).then(rows => {
        const sumSize = rows[0].raw_size === null ? 0 : rows[0].raw_size
        return [
          rows.slice(1),
          sumSize
        ]
      })
    })).then(batchResults => {
      const totalItems = batchResults.map(batchResult => batchResult[0]).flat(1)
      const totalSumSize = batchResults.map(batchResult => batchResult[1]).reduce((a, b) => a + b, 0)

      res.json({
        items: totalItems,
        sum_size: totalSumSize,
        sum_price: CALC_PRICE(totalSumSize)
      })
    }).catch(err => {
      next(err)
    })
  }
}
