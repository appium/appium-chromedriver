"use strict";

var gulp = require('gulp')
  , gutil = require('gulp-util')
  , merge = require('merge-stream')
  , sourcemaps = require('gulp-sourcemaps')
  , mocha = require('gulp-mocha')
  , traceur = require('gulp-traceur')
  , clear = require('clear')
  , Q = require('q')
  , runSequence = Q.denodeify(require('run-sequence'));

var argv   = require('yargs')
              .count('prod')
              .argv;

var exitOnError = false;

function handleError(err) {
  var displayErr = gutil.colors.red(err);
  gutil.log(displayErr);
  if (exitOnError) process.exit(1);
}

var traceurOpts = {
  asyncFunctions: true,
  blockBinding: true,
  modules: 'commonjs',
  annotations: true,
  arrayComprehension: true,
  sourceMaps: true,
  types: true
};

var getTraceurStream = function (src, dest) {
  return gulp.src(src)
              .pipe(sourcemaps.init())
              .pipe(traceur(traceurOpts))
              .pipe(sourcemaps.write())
              .on('error', handleError)
              .pipe(gulp.dest(dest));
};

var transpile = function () {
  var lib = getTraceurStream('lib/**/*.js', 'build/lib');
  var test = getTraceurStream('test/**/*.js', 'build/test');
  return merge(lib, test);
};

gulp.task('transpile', function () {
  if (!argv.prod) {
    traceurOpts.typeAssertions = true;
    traceurOpts.typeAssertionModule = 'rtts-assert';
  }
  transpile();
});

gulp.task('test', ['transpile'], function () {
 return gulp
   .src('build/test/specs.js', {read: false})
   .pipe(mocha({reporter: 'nyan'}))
   .on('error', handleError);
});

gulp.task('kill-gulp', function() {
  process.exit(0);
});

gulp.task('clear-terminal', function() {
  clear();
  return Q.delay(100);
})

// gulp error handling is not very well geared toward watch
// so we have to do that to be safe.
// that should not be needed in gulp 4.0
gulp.task('watch-build', function() {
  return runSequence('clear-terminal', ['transpile', 'test']);
});

gulp.task('watch', function () {
  exitOnError = true;
  gulp.watch(['lib/**/*.js', 'test/**/*.js'], ['watch-build']);
  gulp.watch('gulpfile.js', ['clear-terminal','kill-gulp']);
});
gulp.task('spawn-watch', ['clear-terminal'], function() {
 var spawnWatch = function() {
    var proc = require('child_process').spawn('./node_modules/.bin/gulp', ['watch'], {stdio: 'inherit'});
    proc.on('close', function (code) {
      spawnWatch()
    });
  }
  spawnWatch();
})

// default target is watch
gulp.task('default', ['spawn-watch']);

