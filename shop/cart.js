const createError = require('http-errors');

const { CALC_PRICE } = require('../common');
const { makeSQLBatch } = require('../utils/sqlite');

module.exports = (sqlite) => {
  return (req, res, next) => {
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
  };
};