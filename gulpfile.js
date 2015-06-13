"use strict";

var gulp = require('gulp'),
    boilerplate = require('appium-gulp-plugins').boilerplate.use(gulp);

var files = ["*.js", "bin/**/*.js", "lib/**/*.js", "test/**/*.js",
             "!gulpfile.js","!install*.js"];
boilerplate({
  build: "Appium Chromedriver",
  jscs: false,
  files: files,
  testTimeout: 30000
});
