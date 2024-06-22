import {convertToInt} from '../../lib/utils';

describe('utils', function () {
  let chai;
  let should;

  before(async function () {
    chai = await import('chai');
    should = chai.should();
  });

  describe('convertToInt', function () {
    it('should parse a number', function () {
      convertToInt(0).should.eql(0);
      convertToInt(1).should.eql(1);
      convertToInt(100).should.eql(100);
    });
    it('should return null with NaN', function () {
      should.not.exist(convertToInt(NaN));
    });
    it('should parse a number string', function () {
      convertToInt('0').should.eql(0);
      convertToInt('1.1').should.eql(1);
      convertToInt('-123').should.eql(-123);
    });
    it('should return null if non numer string is given', function () {
      should.not.exist(convertToInt(''));
      should.not.exist(convertToInt('foo'));
    });
    it('should return null if unexpected type', function () {
      should.not.exist(convertToInt({}));
      should.not.exist(convertToInt(null));
      should.not.exist(convertToInt(true));
    });
  });
});
