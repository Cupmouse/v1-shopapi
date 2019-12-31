const util = require('util')
const crypto = require('crypto')

exports.randomBytes = util.promisify(crypto.randomBytes).bind(crypto)
