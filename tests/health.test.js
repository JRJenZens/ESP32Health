import {test} from 'node:test';
import {scenarios} from './scenarios.js';
for(const [name,fn]of scenarios)test(name,fn);
