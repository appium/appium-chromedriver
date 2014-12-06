/* global it:true, describe:true */
import 'traceur/bin/traceur-runtime';
import { Chromedriver } from '../lib/chromedriver';
import should from 'should';
import 'mochawait';

describe('chromedriver', () => {
  it('should exist', () => {
    should.exist(Chromedriver);
  });

  it('should be able to get path to chromedriver executable', () => {
    should.exist(Chromedriver.getPath());
  });
});
