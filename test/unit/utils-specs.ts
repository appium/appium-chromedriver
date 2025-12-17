import {expect} from 'chai';
import {convertToInt} from '../../lib/utils';

describe('utils', function () {
  describe('convertToInt', function () {
    it('should parse a number', function () {
      expect(convertToInt(0)).to.eql(0);
      expect(convertToInt(1)).to.eql(1);
      expect(convertToInt(100)).to.eql(100);
    });
    it('should return null with NaN', function () {
      expect(convertToInt(NaN)).to.not.exist;
    });
    it('should parse a number string', function () {
      expect(convertToInt('0')).to.eql(0);
      expect(convertToInt('1.1')).to.eql(1);
      expect(convertToInt('-123')).to.eql(-123);
    });
    it('should return null if non number string is given', function () {
      expect(convertToInt('')).to.not.exist;
      expect(convertToInt('foo')).to.not.exist;
    });
    it('should return null if unexpected type', function () {
      expect(convertToInt({})).to.not.exist;
      expect(convertToInt(null)).to.not.exist;
      expect(convertToInt(true)).to.not.exist;
    });
  });
});

