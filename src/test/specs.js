/* global it:true, describe:true */
import 'traceur/bin/traceur-runtime';
import { Chromedriver } from '../lib/chromedriver';
import should from 'should';
import 'mochawait';

describe('chromedriver', () => {
  it('should exist', () => {
    should.exist(Chromedriver);
  });
});
