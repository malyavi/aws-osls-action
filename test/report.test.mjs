import {describe, it}                                from 'node:test';
import assert                                         from 'node:assert/strict';
import {location, outputTail, renderComment, renderSummary} from '../lib/report.mjs';
import {readFindings}                                 from '../lib/infra.mjs';

/**
 * What a reader is told about a template they cannot see.
 */

const config = {label: 'Infrastructure', stage: 'staging', maxListed: 2};

const finding = (id, message, path) => ({
  Rule: {Id: id},
  Level: 'Error',
  Message: message,
  Location: {Path: path, Start: {LineNumber: 42}}
});

const clean = (label, slug) => ({label, slug, ok: true, step: null, findings: [], detail: ''});

describe('renderComment', () => {
  it('names every shape it looked at when they all passed', () => {
    const comment = renderComment(config, [clean('us-east-1, no replica'), clean('us-west-1')]);
    assert.match(comment, /^:white_check_mark: \*\*Infrastructure valid\*\* \(staging\)/);
    assert.match(comment, /`us-east-1, no replica`, `us-west-1`/);
  });

  it('says which shape failed and at which step', () => {
    const comment = renderComment(config, [
      clean('us-east-1, no replica'),
      {
        label: 'us-west-1',
        ok: false,
        step: 'cfn-lint',
        findings: [finding('E3005', 'DependsOn OrdersTable does not exist', ['Resources', 'OrdersAlias'])],
        detail: ''
      }
    ]);
    assert.match(comment, /^:x: \*\*Infrastructure invalid\*\* \(staging\)/);
    assert.match(comment, /\*\*us-west-1\*\* — failed at `cfn-lint`/);
    assert.match(comment, /- `E3005` DependsOn OrdersTable does not exist \(`Resources\.OrdersAlias`\)/);
  });

  it('caps the findings and says how many it left out', () => {
    const findings = Array.from({length: 5}, (unused, index) => finding(`E${index}`, `problem ${index}`, ['Resources']));
    const comment = renderComment(config, [{label: 'us-east-1', ok: false, step: 'cfn-lint', findings, detail: ''}]);
    assert.equal(comment.match(/^- `E/gm).length, 2);
    assert.match(comment, /…and 3 more/);
  });

  it('quotes the packaging output, which is the only detail a failed package has', () => {
    const comment = renderComment(config, [{
      label: 'us-east-1',
      ok: false,
      step: 'package',
      findings: [],
      detail: 'Cannot resolve variable ${env:HOSTED_ZONE_ID}'
    }]);
    assert.match(comment, /Cannot resolve variable/);
  });
});

describe('renderSummary', () => {
  it('tables every finding, including the warnings a passing run produced', () => {
    // Not failures — the exit threshold decides that — but a template that has
    // started warning is worth seeing before the warning becomes an error.
    const summary = renderSummary(config, [{
      label: 'us-east-1',
      ok: true,
      step: null,
      findings: [{...finding('W3045', 'Consider using AWS::S3::BucketPolicy', ['Resources', 'Bucket']), Level: 'Warning'}],
      detail: ''
    }]);
    assert.match(summary, /^## :white_check_mark: Infrastructure \(staging\)/);
    assert.match(summary, /packaged and linted clean/);
    assert.match(summary, /\| `W3045` \| Warning \| `Resources\.Bucket`/);
  });

  it('says which step failed for each shape', () => {
    const summary = renderSummary(config, [{label: 'us-west-1', ok: false, step: 'package', findings: [], detail: 'boom'}]);
    assert.match(summary, /### `us-west-1` — failed at `package`/);
    assert.match(summary, /boom/);
  });
});

describe('location', () => {
  it('prefers the resource path, which is what a reader searches for', () => {
    assert.equal(location(finding('E1', 'x', ['Resources', 'Fn'])), '`Resources.Fn`');
  });

  it('falls back to the line number, which is all a parse failure has', () => {
    assert.equal(location({Location: {Start: {LineNumber: 12}}}), 'line 12');
    assert.equal(location({}), 'line ?');
  });
});

describe('outputTail', () => {
  it('keeps the end of the output, where the reason is', () => {
    const output = Array.from({length: 100}, (unused, index) => `line ${index}`).join('\n');
    const kept = outputTail(output);
    assert.match(kept, /line 99$/);
    assert.equal(kept.split('\n').length, 30);
  });
});

describe('readFindings', () => {
  it('answers an empty list for a report that is not there', async () => {
    assert.deepEqual(await readFindings('test/fixtures/nothing-here.json'), []);
  });

  it('reads a real report', async () => {
    const findings = await readFindings('test/fixtures/cfn-lint.json');
    assert.equal(findings.length, 1);
    assert.equal(findings[0].Rule.Id, 'E3005');
  });

  it('answers an empty list for a report that is not a list', async () => {
    assert.deepEqual(await readFindings('test/fixtures/serverless.yml'), []);
  });
});
