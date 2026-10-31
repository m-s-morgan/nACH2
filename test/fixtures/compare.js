// The fork's output must equal the published nach@0.3.5's for every recorded case (nach-0.3.5.json,
// written by generate.js against the npm package). Run from the repository root.
'use strict';

const { execFileSync } = require('child_process');
const path = require('path');
const assert = require('assert');

const expected = require('./nach-0.3.5.json');
const actual = JSON.parse(execFileSync(process.execPath, [path.join(__dirname, 'generate.js'), path.join(__dirname, '..', '..')], {
    env: Object.assign({}, process.env, { TZ: 'America/Los_Angeles' }),
    stdio: ['ignore', 'pipe', 'ignore']
}).toString());

assert.deepStrictEqual(Object.keys(actual), Object.keys(expected));

for (const name of Object.keys(expected)) {
    assert.deepStrictEqual(actual[name], expected[name], `case ${name} differs from nach@0.3.5`);
}

console.log(`fixtures: ${Object.keys(expected).length} cases identical to nach@0.3.5`);
