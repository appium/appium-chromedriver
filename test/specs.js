// transpile:mocha
import { default as Chromedriver } from '../lib/chromedriver';
import chai from 'chai';
import 'mochawait';

should = chai.should();

describe('chromedriver', () => {
  it('should exist', () => {
    should.exist(Chromedriver);
  });

  it('should be able to get path to chromedriver executable', () => {
    should.exist(Chromedriver.getPath());
  });
});

