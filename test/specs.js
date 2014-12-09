// transpile:mocha

import { default as Chromedriver } from '../lib/chromedriver';
import chai from 'chai';
import 'mochawait';

chai.should();

describe('chromedriver', () => {
  it('should exist', () => {
    Chromedriver.should.exist;
  });

  it('should be able to get path to chromedriver executable', () => {
    Chromedriver.getPath().should.exist;
  });
});

