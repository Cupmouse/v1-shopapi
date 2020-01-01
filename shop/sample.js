const createError = require('http-errors')

const fs = require('fs')
const zlib = require('zlib')
const readline = require('readline')

const { DATA_PATH } = require('../common')

module.exports = sqlite => {
  return (req, res, next) => {
    if (req.body === undefined || typeof req.body.id !== 'number' || !Number.isInteger(req.body.id)) {
      next(createError(400, 'Invalid parameters'))
      return
    }

    const id = req.body.id

    new Promise((resolve, reject) => {
      sqlite.prepare('SELECT name FROM items WHERE id = ?', function (err) {
        if (err) {
          reject(err)
        } else {
          resolve(this)
        }
      })
    }).then(stmt => {
      return new Promise((resolve, reject) => {
        stmt.get(id, function (err, row) {
          if (err) {
            reject(err)
          } else {
            resolve(row)
          }
        })
      })
    }).then(row => {
      if (row === undefined) {
        throw createError(400, 'Unknown item ID given')
      }

      const name = row.name
      const path = DATA_PATH + name + '.gz'

      return new Promise((resolve, reject) => {
        const lineReader = readline.createInterface({
          input: fs.createReadStream(path)
            .on('error', (err) => {
              lineReader.close()
              reject(err)
            })
            .pipe(zlib.createGunzip())
        })

        let n = 0
        let text = ''

        lineReader.on('line', (line) => {
          text += line + '\n'
          if (n >= 1000) {
            lineReader.close()
            resolve(text)
          }
          n += 1
        })
        lineReader.on('end', () => {
          lineReader.close()
          resolve(text)
        })
      })
    }).then(text => {
      res.setHeader('content-type', 'text/plain')
      res.send(text)
    }).catch(err => {
      next(err)
    })
  }
}
