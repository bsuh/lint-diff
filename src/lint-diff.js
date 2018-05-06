import Promise from 'bluebird'
import exec from 'execa'
import path from 'path'
import { CLIEngine } from 'eslint'
import {
  T,
  assoc,
  cond,
  curry,
  curryN,
  endsWith,
  evolve,
  equals,
  filter,
  find,
  map,
  objOf,
  pipe,
  pipeP,
  pluck,
  prop,
  propEq,
  split,
  sum,
  tap,
} from 'ramda'
import { getChangedLinesFromDiff } from './lib/git'

const linter = new CLIEngine()
let formatter
let extensions

const getChangedFiles = pipeP(
  commitRange => exec('git', ['diff', commitRange, '--name-only', '--diff-filter=ACM']),
  prop('stdout'),
  split('\n'),
  filter(file => extensions.split(',').some(ext => endsWith(ext, file))),
  map(path.resolve)
)

const getDiff = curry((commitRange, filename) =>
  exec('git', ['diff', commitRange, filename])
    .then(prop('stdout')))

const getChangedFileLineMap = curry((commitRange, filePath) => pipeP(
  getDiff(commitRange),
  getChangedLinesFromDiff,
  objOf('changedLines'),
  assoc('filePath', filePath)
)(filePath))

const lintChangedLines = pipe(
  map(prop('filePath')),
  linter.executeOnFiles.bind(linter)
)

const filterLinterMessages = changedFileLineMap => (linterOutput) => {
  const filterMessagesByFile = (result) => {
    const fileLineMap = find(propEq('filePath', result.filePath), changedFileLineMap)
    const changedLines = prop('changedLines', fileLineMap)

    const filterMessages = evolve({
      messages: filter(message => changedLines.includes(message.line)),
    })

    return filterMessages(result)
  }

  return pipe(
    prop('results'),
    map(filterMessagesByFile),
    objOf('results')
  )(linterOutput)
}

const applyLinter = changedFileLineMap => pipe(
  lintChangedLines,
  filterLinterMessages(changedFileLineMap)
)(changedFileLineMap)

const logResults = results => pipe(
  prop('results'),
  formatter,
  console.log
)(results)

const getErrorCountFromReport = pipe(
  prop('results'),
  pluck('errorCount'),
  sum
)

const exitProcess = curryN(2, n => process.exit(n))

const reportResults = pipe(
  tap(logResults),
  getErrorCountFromReport,
  cond([
    [equals(0), exitProcess(0)],
    [T, exitProcess(1)],
  ])
)

const run = (commitRange = 'HEAD', _extensions = '.js', _formatter) => {
  formatter = linter.getFormatter(_formatter)
  extensions = _extensions

  return Promise.resolve(commitRange)
    .then(getChangedFiles)
    .map(getChangedFileLineMap(commitRange))
    .then(applyLinter)
    .then(reportResults)
}

export default run
