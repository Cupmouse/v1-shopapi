const express = require('express');
const createError = require('http-errors');

const fs = require('fs');
const zlib = require('zlib');
const readline = require('readline');

const { NUL_LIMIT, SQL_PRICE, CALC_PRICE, DATA_PATH } = require('../common');
const { makeSQLBatch } = require('../utils/sqlite');

module.exports = (sqlite) => {
  const router = express.Router();

  router.post('/search', (req, res, next) => {
    let constrains = [];
    let params = [];
    if (typeof req.body.exchanges !== 'undefined' && Array.isArray(req.body.exchanges)) {
      let sql_or = [];
      req.body.exchanges.forEach(exchange => {
        if (typeof exchange === 'string') {
          sql_or.push('exchange = ?');
          params.push(exchange);
        }
      });
      constrains.push('(' + sql_or.join(' OR ') + ')');
    }
    if (typeof req.body.pairs !== 'undefined' && Array.isArray(req.body.pairs)) {
      let sql_or = [];
      req.body.pairs.forEach(pair => {
        if (typeof pair === 'string') {
          sql_or.push('pairs LIKE ? ESCAPE "\\"');
          const sanitized = pair.replace('%', '\\%').replace('_', '\\_');
          params.push('%' + sanitized + '%');
        }
      });
      constrains.push('(' + sql_or.join(' AND ') + ')');
    }
    if (typeof req.body.date_start !== 'undefined' && typeof req.body.date_start === 'number' && Number.isInteger(req.body.date_start)) {
      constrains.push('date_end >= ?');
      params.push(req.body.date_start);
    }
  
    if (typeof req.body.date_end !== 'undefined' && typeof req.body.date_end === 'number' && Number.isInteger(req.body.date_end)) {
      constrains.push('date_start <= ?');
      params.push(req.body.date_end);
    }
  
    let where = '';
    if (params.length > 0) {
      where = ' WHERE ' + constrains.join(' AND ');
    }
  
    let ids;
    sqlite.prepare('SELECT id FROM items' + where, function(err) {
      if (err) {
        console.log(err);
        next(createError(500, 'Database error'));
        return;
      }
  
      this.all(params, (err, rows) => {
        if (err) {
          console.log(err);
          next(createError(500, 'Database error'));
          this.finalize();
          return;
        }
        ids = rows.map(row => row.id);
        this.finalize();
  
        const num_pages = Math.max(Math.ceil(ids.length/NUL_LIMIT), 1);
  
        if (typeof req.body.page !== 'undefined' && typeof req.body.page === 'number' && Number.isInteger(req.body.page) && 1 <= req.body.page) {
          params.push(NUL_LIMIT*(req.body.page-1));
        } else {
          params.push(0);
        }
  
        const sql = 'SELECT id, name, exchange, pairs, date_start, date_end, raw_size, '
          + SQL_PRICE('raw_size', 'price') + ' FROM items'
          + where + ' ORDER BY date_start DESC LIMIT ' + NUL_LIMIT + ' OFFSET ?';
  
        sqlite.prepare(sql, function (err) {
          if (err) {
            console.log(err);
            next(createError(500, 'Database error'));
            return;
          }
  
          this.all(params, (err, rows) => {
            if (err) {
              console.log(err);
              next(createError(500, 'Database error'));
            } else {
              res.json({
                ids: ids,
                items: rows,
                num_page: num_pages,
              });
            }
            this.finalize();
          });
        });
      });
    });
  });
  
  router.post('/cart', (req, res, next) => {
    if (req.body === undefined
      || !Array.isArray(req.body)
      || req.body.some(id => typeof id !== 'number' || !Number.isInteger(id))) {
      res.json({
        items: [],
        sum_size: 0,
        sum_price: 0,
      });
      return;
    }
  
    const ids = req.body;
    const batches = makeSQLBatch(ids);
  
    // split sql query into batch
    Promise.all(batches.map(batch => {
      const parameters = Array(batch.length).fill('?').join(', ');
  
      const sql = 'SELECT id, name, raw_size FROM items WHERE id IN (' + parameters + ') '
        + 'UNION SELECT -1, "", sum(raw_size) FROM items WHERE id IN (' + parameters + ') ';
  
      return new Promise((resolve, reject) => {
        sqlite.prepare(sql, function(err) {
          if (err)
            reject(err);
          else
            resolve(this);
        });
      }).then(stmt => {
        return new Promise((resolve, reject) => {
          stmt.all(batch.concat(batch), (err, rows) => {
            if (err)
              reject(err);
            else
              resolve(rows);
          });
        })
      }).then(rows => {
        const sum_size = rows[0].raw_size === null ? 0 : rows[0].raw_size;
        return [ rows.slice(1), sum_size ];
      });
    })).then(batch_results => {
      const total_items = batch_results.map(batch_result => batch_result[0]).flat(1);
      const total_sum_size = batch_results.map(batch_result => batch_result[1]).reduce((a, b) => a + b, 0);
  
      res.json({
        items: total_items,
        sum_size: total_sum_size,
        sum_price: CALC_PRICE(total_sum_size),
      });
    }).catch(err => {
      console.log(err);
      next(createError(500, 'Database error'));
    });
  });
  
  router.post('/sample', (req, res, next) => {
    if (req.body === undefined || typeof req.body.id !== 'number' || !Number.isInteger(req.body.id)) {
      next(createError(400, 'Invalid parameters'));
      return;
    }
  
    const id = req.body.id;
  
    new Promise((resolve, reject) => {
      sqlite.prepare('SELECT name FROM items WHERE id = ?', function (err) {
        if (err)
          reject(err);
        else
          resolve(this);
      });
    }).then(stmt => {
      return new Promise((resolve, reject) => {
        stmt.get(id, function (err, row) {
          if (err)
            reject(err);
          else
            resolve(row);
        });
      });
    }).then(row => {
      if (row === undefined)
        return Promise.reject('id');
      
      const name = row.name;
      const path = DATA_PATH + name + '.gz';
  
      const lineReader = readline.createInterface({
        input: fs.createReadStream(path).pipe(zlib.createGunzip()),
      });
  
      let n = 0;
      let text = '';
  
      return new Promise((resolve, reject) => {
        lineReader.on('line', (line) => {
          text += line + '\n';
          if (n >= 1000) {
            lineReader.close();
            resolve(text);
          }
          n += 1;
        });
        lineReader.on('end', () => {
          lineReader.close();
          resolve(text);
        });
      });
    }).then(text => {
      res.setHeader('content-type', 'text/plain');
      res.send(text);
    }).catch(err => {
      if (err === 'id') {
        next(createError(400, 'Database with id not found'));
      } else {
        console.log(err);
        next(createError(500, 'Database error'));
      }
    });
  });

  return router;
}