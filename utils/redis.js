const redis = require('redis');

const util = require('util');

class Redis {
  constructor() {
    this.redcli = redis.createClient();

    this.GET = util.promisify(this.redcli.GET).bind(this.redcli);
    this.SET = util.promisify(this.redcli.SET).bind(this.redcli);
    this.MSET = util.promisify(this.redcli.MSET).bind(this.redcli);
    this.MGET = util.promisify(this.redcli.MGET).bind(this.redcli);
    this.INCR = util.promisify(this.redcli.INCR).bind(this.redcli);
    this.SETNX = util.promisify(this.redcli.SETNX).bind(this.redcli);
    this.DEL = util.promisify(this.redcli.DEL).bind(this.redcli);
    
    this.PEXPIRE = util.promisify(this.redcli.PEXPIRE).bind(this.redcli);

    this.SADD = util.promisify(this.redcli.SADD).bind(this.redcli);
    this.SMEMBERS = util.promisify(this.redcli.SMEMBERS).bind(this.redcli);
    this.SISMEMBER = util.promisify(this.redcli.SISMEMBER).bind(this.redcli);

    this.HMSET = util.promisify(this.redcli.HMSET).bind(this.redcli);
    this.HGETALL = util.promisify(this.redcli.HGETALL).bind(this.redcli);

    this.LPUSH = util.promisify(this.redcli.LPUSH).bind(this.redcli);
    this.LRANGE = util.promisify(this.redcli.LRANGE).bind(this.redcli);
  }
}

module.exports = Redis;