const createError = require('http-errors');

const { NUL_LIMIT, SQL_PRICE } = require('../common');

module.exports = sqlite => {
  return (req, res, next) => {
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
  };
};