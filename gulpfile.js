"use strict";

var gulp = require('gulp'),
    merge = require('merge-stream'),
    mocha = require('gulp-mocha'),
    Q = require('q'),
    spawnWatcher = require('appium-gulp-plugins').spawnWatcher.use(gulp),
    Transpiler = require('appium-gulp-plugins').Transpiler,
    runSequence = Q.denodeify(require('run-sequence')),
    jshint = require('gulp-jshint'),
    jscs = require('gulp-jscs'),
    vinylPaths = require('vinyl-paths'),
    del = require('del');

var argv = require('yargs')
            .count('prod')
            .argv;

gulp.task('clean', function () {
  return gulp.src('build', {read: false})
    .pipe(vinylPaths(del));
});

gulp.task('transpile', function () {
  var transpiler = new Transpiler();
  if (!argv.prod) {
    transpiler.traceurOpts.typeAssertions = true;
    transpiler.traceurOpts.typeAssertionModule = 'rtts-assert';
  }

  var index = gulp.src('index.js')
    .pipe(transpiler.stream())
    .on('error', spawnWatcher.handleError)
    .pipe(gulp.dest('build'));

  var lib = gulp.src('lib/**/*.js')
    .pipe(transpiler.stream())
    .on('error', spawnWatcher.handleError)
    .pipe(gulp.dest('build/lib'));

  var test = gulp.src('test/**/*.js')
    .pipe(transpiler.stream())
    .on('error', spawnWatcher.handleError)
    .pipe(gulp.dest('build/test'));

  return merge(index, lib, test);
});

gulp.task('jscs', function () {
  return gulp
   .src(['gulpfile.js'])
   .pipe(jscs())
   .on('error', spawnWatcher.handleError);
});

gulp.task('jshint', function () {
  return gulp
   .src(['*.js', 'lib/**/*.js', 'test/**/*.js'])
   .pipe(jshint())
   .pipe(jshint.reporter('jshint-stylish'))
   .pipe(jshint.reporter('fail'))
   .on('error', spawnWatcher.handleError);
});

gulp.task('lint',['jshint','jscs']);

gulp.task('test', ['transpile'],  function () {
  process.env.SKIP_TRACEUR_RUNTIME = true;
  return gulp
   .src('build/test/**/*-specs.js', {read: false})
   .pipe(mocha({reporter: 'nyan'}))
   .on('error', spawnWatcher.handleError);
});

process.env.APPIUM_NOTIF_BUILD_NAME = 'appium-chromedriver';

spawnWatcher.configure('watch', ['lib/**/*.js','test/**/*.js'], function () {
  return runSequence('clean', 'lint', 'transpile', 'test');
});

gulp.task('once', function () {
  return runSequence('clean','lint', 'transpile','test');
});

gulp.task('default', ['watch']);

