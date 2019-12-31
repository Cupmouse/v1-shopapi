const createError = require('http-errors')

const base64url = require('base64url')
const moment = require('moment')
const checkoutsdk = require('@paypal/checkout-server-sdk')

const { CALC_PRICE, PAYPAL_ID, PAYPAL_SECRET } = require('../common')
const { makeSQLBatch } = require('../utils/sqlite')
const { randomBytes } = require('../utils/promisified')

const newPaypalClient = () => new checkoutsdk.core.PayPalHttpClient(
  new checkoutsdk.core.SandboxEnvironment(PAYPAL_ID, PAYPAL_SECRET)
)

module.exports = (redis, sqlite) => {
  return (req, res, next) => {
    if (typeof req.body.order_id !== 'string') {
      console.log('order_id')
      next(createError(400, 'Invalid parameter'))
      return
    }
    if (req.body.ids === undefined ||
      !Array.isArray(req.body.ids) ||
      req.body.ids.some(id => typeof id !== 'number' || !Number.isInteger(id))) {
      console.log('ids')
      next(createError(400, 'Invalid parameter'))
      return
    }

    const paypalId = req.body.order_id
    const userId = req.body.user_id
    const ids = req.body.ids

    let orderId
    let price
    let itemCodes
    let value
    let sumSize

    redis.SISMEMBER('order:used', paypalId).then(yes => {
      if (yes === 1) {
        // this order is already used
        return Promise.reject('orderid')
      }

      const request = new checkoutsdk.orders.OrdersGetRequest(paypalId)

      return newPaypalClient().execute(request)
    }).then(order => {
      // validate order
      if (order.result.purchase_units[0].amount.currency_code !== 'USD') {
        return Promise.reject('onlyusd')
      }
      if (order.result.status !== 'COMPLETED') {
        return Promise.reject('incomplete')
      }

      value = order.result.purchase_units[0].amount.value

      const batches = makeSQLBatch(ids)

      return Promise.all(batches.map(batch => {
        const parameters = Array(batch.length).fill('?').join(', ')

        return new Promise((resolve, reject) => {
          sqlite.prepare('SELECT sum(raw_size) as sum_size FROM items WHERE id IN (' + parameters + ') ', function (err) {
            if (err) {
              reject(err)
            } else {
              resolve(this)
            }
          })
        }).then(stmt => {
          return new Promise((resolve, reject) => {
            stmt.get(batch, (err, row) => {
              if (err) {
                reject(err)
              } else {
                resolve(row.sum_size)
              }
            })
          })
        })
      })).then(sumSizeArr => {
        return sumSizeArr.reduce((a, b) => a + b, 0)
      })
    }).then(totalSumSize => {
      sumSize = totalSumSize
      const bigprice = CALC_PRICE(sumSize)

      if (bigprice < 500) {
        return Promise.reject('toosmall')
      }

      const priceStr = bigprice.toString()
      price = priceStr.slice(0, -2) + '.' + priceStr.slice(-2)

      if (value !== price) {
        return Promise.reject('value')
      }

      return randomBytes(32)
    }).then(buf => {
      orderId = base64url(buf)

      // add paypal order id so as not to be used again
      return redis.SADD('order:used', paypalId)
    }).then(count => {
      return redis.SET('order:' + orderId + ':paypal', paypalId)
    }).then(ok => {
      // generate URLs
      return Promise.all(
        ids.map(id => randomBytes(32).then(buf => base64url(buf)))
      )
    }).then(codes => {
      itemCodes = codes

      const request = Array(itemCodes.length * 2)
      itemCodes.forEach((code, i) => {
        request[2 * i] = 'itemcode:' + code + ':id'
        request[2 * i + 1] = ids[i]
      })

      return redis.MSET(...request)
    }).then(alwayszero => {
      const request = Array(ids.length * 2)
      ids.forEach((id, i) => {
        request[2 * i] = id
        request[2 * i + 1] = itemCodes[i]
      })

      return redis.HMSET('order:' + orderId + ':item', ...request)
    }).then(ok => {
      return redis.SET('order:' + orderId + ':size', sumSize)
    }).then(ok => {
      return redis.SET('order:' + orderId + ':date', moment().utc().unix())
    }).then(ok => {
      return redis.SET('order:' + orderId + ':total', price)
    }).then(ok => {
      return redis.LPUSH('user:' + userId + ':order', orderId)
    }).then(ok => {
      return redis.SADD('user:' + userId + ':item', ids)
    }).then(count => {
      res.json({ success: true })
    }).catch(err => {
      if (err === 'orderid') {
        console.error('Order id already used', paypalId)
        next(createError(400, 'Order id already used'))
      } else if (err === 'onlyusd') {
        console.log('Only accepts USD', paypalId)
        next(createError(400, 'Only USD is accepted'))
      } else if (err === 'toosmall') {
        console.log('Total is too small')
        next(createError(400, 'Total is too small'))
      } else if (err === 'incomplete') {
        console.log('Not complete', paypalId)
        next(createError(400, 'Order is not complete'))
      } else if (err === 'value') {
        console.log(paypalId)
        next(createError(400, 'Payment value mismatch'))
      } else {
        console.log(err, paypalId)
        next(createError(500, 'Communication error'))
      }
    })
  }
}
