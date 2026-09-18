import {copyFile, readFile}  from 'node:fs/promises';
import {warn}                from './core.mjs';
import {run, runCommandLine} from './exec.mjs';
import {shapeEnv}            from './config.mjs';
import {outputTail}          from './report.mjs';

/**
 * Packaging one template shape and linting it.
 *
 * Two passes, and they catch different things:
 *
 *  1. **Packaging** resolves every `${...}`, bundles the handlers, and
 *     synthesizes the CloudFormation. This is what catches an undefined
 *     variable, a handler path that names nothing, a plugin that is in the
 *     configuration but not in `package.json`, and any import that does not
 *     bundle.
 *  2. **cfn-lint** reads the synthesized template against the resource
 *     schemas. This is what catches a property CloudFormation does not have, a
 *     wrong type, and a `DependsOn` or `Ref` pointing at a logical id that is
 *     not there. Packaging is happy with all of those.
 */

/**
 * Packages and lints one shape.
 *
 * @param {object} config Resolved configuration
 * @param {{ label: string, slug: string, region: string, secondary: string }} shape The shape to validate
 * @return {Promise<{ label: string, region: string, slug: string, ok: boolean, step: string|null, findings: Array<object>, detail: string, templatePath: string, findingsPath: string }>} Outcome
 */
export async function validateShape(config, shape) {
  const findingsPath = `cfn-lint-${shape.slug}.json`;
  const outcome = {
    label: shape.label,
    region: shape.region,
    slug: shape.slug,
    ok: true,
    step: null,
    findings: [],
    detail: '',
    templatePath: '',
    findingsPath
  };

  try {
    await runCommandLine(
      config.packageCommand,
      ['--stage', config.stage, '--region', shape.region, ...config.packageArgs],
      {env: shapeEnv(config, shape)}
    );
  } catch (thrown) {
    return {
      ...outcome,
      ok: false,
      step: 'package',
      detail: outputTail(thrown.output ?? thrown.message)
    };
  }

  // Kept per shape: packaging overwrites the same path every time, so without
  // this a reviewer can only read the last template a run produced — and the
  // one they want is usually an earlier one.
  outcome.templatePath = `cloudformation-template-${shape.slug}.json`;
  try {
    await copyFile(config.templatePath, outcome.templatePath);
  } catch (thrown) {
    warn(`Could not keep a copy of the ${shape.label} template: ${thrown.message}`);
    outcome.templatePath = config.templatePath;
  }

  if (!config.lint) {
    return outcome;
  }

  let lintFailed = false;
  try {
    await runCommandLine(config.lintCommand, [
      config.templatePath,
      '--format', 'json',
      '--output-file', findingsPath,
      ...(config.nonZeroExitCode ? ['--non-zero-exit-code', config.nonZeroExitCode] : []),
      ...config.lintArgs
    ]);
  } catch {
    // The findings file is the report, and it is written whether the command
    // exits zero or not — so the exit code only decides the verdict.
    lintFailed = true;
  }

  return {
    ...outcome,
    ok: !lintFailed,
    step: lintFailed ? 'cfn-lint' : null,
    findings: await readFindings(findingsPath)
  };
}

/**
 * Reads cfn-lint's JSON report.
 *
 * Written to a file rather than captured from stdout so that a non-zero exit —
 * which is the interesting case — still leaves the findings somewhere readable.
 *
 * @param {string} path Where cfn-lint was told to write
 * @return {Promise<Array<object>>} Findings, empty when the file is missing or unparseable
 */
export async function readFindings(path) {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (thrown) {
    warn(`Could not read cfn-lint findings from ${path}: ${thrown.message}`);
    return [];
  }
}

/**
 * Installs cfn-lint.
 *
 * pip rather than a pinned binary because cfn-lint is a Python package and
 * every GitHub-hosted runner already has an interpreter.
 *
 * @param {{ lintVersion: string }} config Resolved configuration
 * @return {Promise<void>}
 */
export async function installCfnLint({lintVersion}) {
  await run('pip', [
    'install',
    '--quiet',
    '--disable-pip-version-check',
    lintVersion ? `cfn-lint==${lintVersion}` : 'cfn-lint'
  ]);
}
