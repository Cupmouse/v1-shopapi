const express = require('express')

const search = require('./search')
const cart = require('./cart')
const sample = require('./sample')

module.exports = sqlite => {
  const router = express.Router()

  router.post('/search', search(sqlite))
  router.post('/cart', cart(sqlite))
  router.post('/sample', sample(sqlite))

  return router
}
