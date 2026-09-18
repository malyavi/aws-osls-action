import {writeFileSync}                          from 'node:fs';
import {afterEach, describe, it}                from 'node:test';
import assert                                   from 'node:assert/strict';
import {ConfigError}                            from '../lib/inputs.mjs';
import {parseEnv, resolveConfig, shapeEnv}      from '../lib/config.mjs';
import {mainRegion, parseShapes, resolveShapes} from '../lib/shapes.mjs';

/**
 * Which templates get synthesized. Get this wrong and the check passes by
 * looking only at the shape that was never going to break.
 */

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('INPUT_')) {
      delete process.env[key];
    }
  }
});

const base = {
  configFile: 'test/fixtures/serverless.yml',
  mainRegionKey: 'mainRegion',
  secondaryRegion: '',
  validationSecondaryRegion: '',
  shapes: null
};

describe('mainRegion', () => {
  it('reads the region out of the configuration, so the two cannot disagree', () => {
    assert.equal(mainRegion({...base, mainRegion: ''}), 'us-east-1');
  });

  it('prefers an explicit input', () => {
    assert.equal(mainRegion({...base, mainRegion: 'eu-west-1'}), 'eu-west-1');
  });

  it('refuses with advice when the file cannot be read', () => {
    assert.throws(() => mainRegion({...base, mainRegion: '', configFile: 'nowhere.yml'}), (thrown) => {
      assert.ok(thrown instanceof ConfigError);
      assert.match(thrown.message, /`main-region`/);
      assert.match(thrown.message, /`config-file`/);
      return true;
    });
  });

  it('refuses with advice when the file holds no such key', () => {
    const path = 'test/fixtures/no-region.yml';
    writeFileSync(path, 'service: thing\nprovider:\n  name: aws\n');
    assert.throws(() => mainRegion({...base, mainRegion: '', configFile: path}), /mainRegion:/);
  });

  it('takes the key name from the caller, for a configuration that spells it differently', () => {
    const path = 'test/fixtures/other-key.yml';
    writeFileSync(path, 'custom:\n  primaryRegion: ap-south-1\n');
    assert.equal(mainRegion({...base, mainRegion: '', configFile: path, mainRegionKey: 'primaryRegion'}), 'ap-south-1');
  });
});

describe('resolveShapes', () => {
  it('is one shape for a single-region stage', () => {
    assert.deepEqual(resolveShapes({...base, mainRegion: 'us-east-1'}), [
      {label: 'us-east-1', slug: 'us-east-1', region: 'us-east-1', secondary: ''}
    ]);
  });

  it('is three shapes for a two-region stage, and each is a different document', () => {
    // The replica exists in one and not the other, and the secondary region is
    // where a Fn::GetAtt against a conditional resource goes unresolved.
    const shapes = resolveShapes({...base, mainRegion: 'us-east-1', secondaryRegion: 'us-west-1'});
    assert.deepEqual(shapes.map((shape) => shape.slug), ['us-east-1-single', 'us-east-1-replicated', 'us-west-1']);
    assert.deepEqual(shapes.map((shape) => shape.secondary), ['', 'us-west-1', 'us-west-1']);
  });

  it('uses the validation region when the stage names none, which is what a pull request sees', () => {
    // A pull request job runs in no environment, so no stage's variables reach
    // it — and validating only the single-region shape would be the weakest of
    // the three.
    const shapes = resolveShapes({...base, mainRegion: 'us-east-1', validationSecondaryRegion: 'us-west-1'});
    assert.equal(shapes.length, 3);
  });

  it('prefers the stage\'s own secondary region over the validation one', () => {
    const shapes = resolveShapes({
      ...base,
      mainRegion: 'us-east-1',
      secondaryRegion: 'eu-west-1',
      validationSecondaryRegion: 'us-west-1'
    });
    assert.deepEqual(shapes.at(-1).region, 'eu-west-1');
  });

  it('refuses a secondary region that is already the main one', () => {
    assert.throws(
      () => resolveShapes({...base, mainRegion: 'us-east-1', secondaryRegion: 'us-east-1'}),
      /already the main region/
    );
  });

  it('uses the shapes a caller listed instead of deriving any', () => {
    const shapes = [{label: 'one', slug: 'one', region: 'us-east-2', secondary: ''}];
    assert.deepEqual(resolveShapes({...base, shapes}), shapes);
  });
});

describe('parseShapes', () => {
  it('reads nothing for an absent or automatic value', () => {
    assert.equal(parseShapes(''), null);
    assert.equal(parseShapes('auto'), null);
    assert.equal(parseShapes('   '), null);
  });

  it('fills in a label and a slug from the regions', () => {
    assert.deepEqual(parseShapes('[{"region":"us-east-1"},{"region":"us-east-1","secondary":"us-west-1"}]'), [
      {label: 'us-east-1', slug: 'us-east-1', region: 'us-east-1', secondary: ''},
      {
        label: 'us-east-1, replica in us-west-1',
        slug: 'us-east-1-replicated',
        region: 'us-east-1',
        secondary: 'us-west-1'
      }
    ]);
  });

  it('refuses a value that is not JSON, or not a list of regions', () => {
    assert.throws(() => parseShapes('us-east-1'), /not valid JSON/);
    assert.throws(() => parseShapes('{}'), /non-empty JSON array/);
    assert.throws(() => parseShapes('[]'), /non-empty JSON array/);
    assert.throws(() => parseShapes('[{"label":"x"}]'), /Shape 0 .* no `region`/);
  });
});

describe('shapeEnv', () => {
  const config = {
    secondaryRegionVariable: 'SECONDARY_REGION',
    accountId: '000000000000',
    extraEnv: {HOSTED_ZONE_ID: 'Z123'}
  };

  it('sets the secondary-region variable even when it is empty', () => {
    // A value left over in the runner's environment would otherwise leak into
    // the single-region template and make it a copy of the other shape.
    assert.equal(shapeEnv(config, {secondary: ''}).SECONDARY_REGION, '');
    assert.equal(shapeEnv(config, {secondary: 'us-west-1'}).SECONDARY_REGION, 'us-west-1');
  });

  it('passes the placeholder account id, so nothing calls STS', () => {
    assert.equal(shapeEnv(config, {secondary: ''}).AWS_ACCOUNT_ID, '000000000000');
  });

  it('carries the caller\'s own template variables', () => {
    assert.equal(shapeEnv(config, {secondary: ''}).HOSTED_ZONE_ID, 'Z123');
  });

  it('does not let an extra variable override the region it is setting', () => {
    const withClash = {...config, extraEnv: {SECONDARY_REGION: 'eu-west-1'}};
    assert.equal(shapeEnv(withClash, {secondary: ''}).SECONDARY_REGION, '');
  });
});

describe('parseEnv', () => {
  it('reads KEY=value entries and keeps a value containing an equals sign', () => {
    assert.deepEqual(parseEnv(['A=1', 'B=x=y']), {A: '1', B: 'x=y'});
  });

  it('ignores an entry with no key', () => {
    assert.deepEqual(parseEnv(['=1', 'nonsense']), {});
  });
});

describe('resolveConfig', () => {
  it('defaults to osls, cfn-lint and a warning threshold', () => {
    const config = resolveConfig();
    assert.equal(config.stage, 'dev');
    assert.equal(config.packageCommand, 'npx osls package');
    assert.equal(config.lint, true);
    assert.equal(config.nonZeroExitCode, 'warning');
    assert.equal(config.templatePath, '.serverless/cloudformation-template-update-stack.json');
    assert.equal(config.section, 'infra');
  });

  it('reads the shapes and the extra environment from their inputs', () => {
    process.env.INPUT_SHAPES = '[{"region":"us-east-2"}]';
    process.env.INPUT_EXTRA_ENV = 'A=1\nB=2';
    const config = resolveConfig();
    assert.equal(config.shapes.length, 1);
    assert.deepEqual(config.extraEnv, {A: '1', B: '2'});
  });
});
