const express = require('express');

const { checkCaptcha } = require('../utils/recaptcha');

const checkPassword = require('./checkpassword');
const checkSession = require('./checksession');
const extendSession = require('./extendsession');

const signup = require('./signup');
const login = require('./login');
const isloggedin = require('./isloggedin');
const logout = require('./logout');
const bought = require('./bought');
const purchase = require('./purchase');
const listorder = require('./listorder');

module.exports = (redis, sqlite) => {
  const checkSessionInst = checkSession(redis);
  const extendSessionInst = extendSession(redis);

  const router = express.Router();

  router.post('/signup', checkPassword, checkCaptcha, signup(redis));

  router.post('/login', checkPassword, checkCaptcha, login(redis));
  router.post('/isloggedin', checkSessionInst, extendSessionInst, isloggedin);
  router.post('/logout', checkSessionInst, logout(redis));

  router.post('/bought', checkSessionInst, extendSessionInst, bought(redis));
  router.post('/purchase', checkSessionInst, extendSessionInst, purchase(redis, sqlite));
  router.post('/listorder', checkSessionInst, extendSessionInst, listorder(redis));

  return router;
};