"use strict";

var gulp = require('gulp')
  , gutil = require('gulp-util')
  , merge = require('merge-stream')
  , mocha = require('gulp-mocha')
  , Q = require('q')
  , Transpiler = require('appium-gulp-plugins').Transpiler
  , spawnWatcher = require('appium-gulp-plugins').spawnWatcher.use(gulp)
  , runSequence = Q.denodeify(require('run-sequence'));

var argv = require('yargs')
            .count('prod')
            .argv;

var getTraceurStream = function (src, dest) {
  return gulp.src(src)
    .pipe(transpile())
    .on('error', spawnWatcher.handleError)
    .pipe(gulp.dest(dest));
};

gulp.task('transpile', function () {
  var transpiler = new Transpiler();
  if (!argv.prod) {
    transpiler.traceurOpts.typeAssertions = true;
    transpiler.traceurOpts.typeAssertionModule = 'rtts-assert';
  }
  var lib = gulp.src('lib/**/*.js')
    .pipe(transpiler.stream())
    .on('error', spawnWatcher.handleError)
    .pipe(gulp.dest('build/lib'));

  var test = gulp.src('test/**/*.js')
    .pipe(transpiler.stream())
    .on('error', spawnWatcher.handleError)
    .pipe(gulp.dest('build/test'));

  return merge(lib, test);
});

gulp.task('test', ['transpile'], function () {
  process.env.SKIP_TRACEUR_RUNTIME = true;
  return gulp
   .src('build/test/specs.js', {read: false})
   .pipe(mocha({reporter: 'nyan'}))
   .on('error', spawnWatcher.handleError);
});

spawnWatcher.configure('watch', ['lib/**/*.js','test/**/*.js'], function() {
  return runSequence('test');
});

// default target is watch
gulp.task('default', ['spawn-watch']);

