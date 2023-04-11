#!/usr/bin/env node

const Table = require('cli-table3');
const colors = require('colors/safe');
const path = require('path');
const fs = require('fs-extra');
const { settings } = require('./settings');

const { getTestSuitePaths, distributeTestsByWeight } = require('./test-suites');
const {
  formatTime,
  generateWeightsFile,
  collectResults
} = require('./utility');
const { executeThread } = require('./thread');
const { resultsPath } = require('./shared-config');

function cleanResultsPath() { 
  if(!fs.existsSync(resultsPath)) {
    fs.mkdirSync(resultsPath, { recursive: true }) 
  } else {
    fs.readdir(resultsPath, (err, files) => {
      if (err) console.log(err); 
        for (const file of files) {
          fs.unlink(path.join(resultsPath, file), err => { if (err) console.log(err); }); 
        } 
      });
    }
  }

async function start() {
  cleanResultsPath();
  const testSuitePaths = await getTestSuitePaths();
  const threads = distributeTestsByWeight(testSuitePaths);
  const start = new Date();
  await Promise.all(threads.map(executeThread));
  const end = new Date();
  const timeTaken = end.getTime() - start.getTime();

  const resultsPath = path.join(process.cwd(), 'runner-results');
  const resultMaps = [collectResults(resultsPath)];

  let timeMap = new Map();

  // should split below into calculateStatistics and presentResult methods
  resultMaps.forEach((m, t) => {
    let totTimeThread = 0;
    for (let [name, test] of m) {
      totTimeThread += test.duration;
    }

    timeMap = new Map([...timeMap, ...m]);
  });

  let table = new Table({
    head: ['Spec', 'Time', 'Tests', 'Passing', 'Failing', 'Pending'],
    style: { head: ['blue'] },
    colWidths: [50, 8, 7, 9, 9, 9]
  });

  let totalTests = 0;
  let totalPasses = 0;
  let totalFailures = 0;
  let totalDuration = 0;
  let totalPending = 0;

  let totalWeight = timeMap.size * 10;
  let specWeights = {};
  let errorMap = new Map()
  for (let [name, suite] of timeMap) {
    //The value of suite.tests is not what we expect.
    const nbTests = suite.passes + suite.pending + suite.failures;
    totalDuration += suite.duration;
    totalTests += nbTests;
    totalPasses += suite.passes;
    totalPending += suite.pending;
    totalFailures += suite.failures;
    specWeights[name] = { time: suite.duration, weight: 0 };
    table.push([
      name,
      `${formatTime(suite.duration)}`,
      nbTests,
      suite.passes,
      suite.failures > 0 ? colors.red(suite.failures) : suite.failures,
      suite.pending
    ]);
    // add any errors
    if(suite.errors?.length) errorMap.set(suite.errors[0].suiteName, suite.errors)
  }
  table.push([
    'Results',
    `${formatTime(totalDuration)}`,
    totalTests,
    totalPasses,
    totalFailures > 0 ? colors.red(totalFailures) : totalFailures,
    totalPending
  ]);

  console.log(table.toString());

  //log errors | for some reason .padStart() doesnt seem to work and i just need this to work for now
  //TODO: make this nice
  errorMap.forEach((error, suiteName) => {
    console.log()
    console.log(`  ${(suiteName)}`)
    error.forEach((errorResult, i) => {
      console.log()
      console.log(`    ${i + 1}) ${errorResult.test}`);
      console.log(`      ${colors.red(errorResult.message)}`);
      console.log()
    })
  });
  // fail on missing results (had some issues with missing test results, prevent that from slipping past again)
  if (settings.strictMode && timeMap.size !== testSuitePaths.length) {
    console.error(`Found test suites does not match results.`);
    console.error(`Test suites found: ${testSuitePaths.length}`);
    console.error(`Test suite results: ${timeMap.size}`);
    console.error(
      'Some test suites likely terminated without passing on results, exit with error'
    );
    const missingTestResults = testSuitePaths.filter(
      (path) => !timeMap.get(path)
    );
    console.log(
      `The following test suites are missing results: ${missingTestResults}`
    );
    process.exit(1);
  }

  if (totalFailures > 0) {
    process.stderr.write(`\x1b[31m${totalFailures} test failure(s)\n`);
    process.exit(1);
  }

  const timeSaved = totalDuration - timeTaken;
  console.log(
    `Total run time: ${totalDuration / 1000}s, executed in: ${
      timeTaken / 1000
    }, saved ${timeSaved / 1000} (~${Math.round(
      (timeSaved / totalDuration) * 100
    )}%)`
  );

  generateWeightsFile(specWeights, totalDuration, totalWeight);
  process.exit(totalFailures);
}

start();
