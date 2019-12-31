exports.PATH_DATA_DB = './items.db';
exports.PAYPAL_ID = process.env.NODE_ENV === 'production' ?
  'AfVrtn4Iog5c7b8cIRE7-QIHIBXkH8f4lRgMDlSBENNoQwF37_tos0kwMR9ZVQy2NSbOKk32lZ9X5doD' :
  'ATdZPSLf61TWnm1v7iYfTvVY0BtoitHdKxjZBHmUZmAXPZyp5U2x3KUCNoYn0d65eTzOCkRvSqotyv2z';
exports.PAYPAL_SECRET = process.env.NODE_ENV === 'production' ?
  'EMF4fDLEhQdRV5CPKSLc6pZMr4ruRo2kHxekrzzgeUVWvzXzhG5rDWLVrnPKRUb5Vjk2WYs1JEtDnKtk' :
  'EG7pocZM097wbmqNIdvBYtNqKf56YWSOU46kAPededPajJ_BURphY7AnRrnI_jfV4B-1dXjFxHdb7mLn';
exports.DATA_PATH = process.env.NODE_ENV === 'production' ?
  '/home/exchangedatasets/HDD/items/' :
  '/home/shimaoka/data/items/';
exports.DOWNLOAD_LIMIT = 3;
exports.RECAPTCHA_SECRET = '6LfFackUAAAAALRDhZuVX0bPMsZR3oDpw1qru7gh';
exports.RECAPTCHA_URL = 'https://www.google.com/recaptcha/api/siteverify';
exports.SQL_BATCH_SIZE = 400;
exports.SALT_ROUNDS = 13;
exports.LENGTH_SESSION_ID = 64;
exports.SESSION_TIME = 3 * 60 * 60 * 1000; // 3 hours
exports.NUL_LIMIT = 10;
exports.PRICE = 3n;
exports.SQL_PRICE = (col,as) => 'CAST(3*100*CAST(' + col + ' AS REAL)/1024/1024/1024 AS INTEGER) AS ' + as;
exports.CALC_PRICE = (raw_size) => {
  const sum = BigInt(raw_size);

  return Number(sum * exports.PRICE * 100n / 1073741824n);
};
exports.CORS_ORIGIN = process.env.NODE_ENV === 'production' ? 'https://shop.exchangedataset.cc/' : 'http://localhost:3000'
