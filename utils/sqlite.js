const { SQL_BATCH_SIZE } = require('../common');

exports.makeSQLBatch = (data) => {
  const batches = [];

  for (let i = 0; i < data.length; i+=SQL_BATCH_SIZE) {
    batches.push(data.slice(i, i+SQL_BATCH_SIZE));
  }

  return batches;
}