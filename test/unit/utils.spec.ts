import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {convertToInt} from '../../lib/utils.js';

describe('utils', function () {
  describe('convertToInt', function () {
    it('should parse a number', function () {
      assert.strictEqual(convertToInt(0), 0);
      assert.strictEqual(convertToInt(1), 1);
      assert.strictEqual(convertToInt(100), 100);
    });
    it('should return null with NaN', function () {
      assert.strictEqual(convertToInt(NaN), null);
    });
    it('should parse a number string', function () {
      assert.strictEqual(convertToInt('0'), 0);
      assert.strictEqual(convertToInt('1.1'), 1);
      assert.strictEqual(convertToInt('-123'), -123);
    });
    it('should return null if non number string is given', function () {
      assert.strictEqual(convertToInt(''), null);
      assert.strictEqual(convertToInt('foo'), null);
    });
    it('should return null if unexpected type', function () {
      assert.strictEqual(convertToInt({}), null);
      assert.strictEqual(convertToInt(null), null);
      assert.strictEqual(convertToInt(true), null);
    });
  });
});
