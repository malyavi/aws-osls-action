import {commentConfig, updateCommentSection} from '../lib/comment.mjs';
import {resolveConfig}                       from '../lib/config.mjs';
import {error, group, setOutput, summary}    from '../lib/core.mjs';
import {runCommandLine}                      from '../lib/exec.mjs';
import {failureMessage}                      from '../lib/inputs.mjs';
import {installCfnLint, validateShape}       from '../lib/infra.mjs';
import {renderComment, renderSummary}        from '../lib/report.mjs';
import {resolveShapes}                       from '../lib/shapes.mjs';

/**
 * Validates the infrastructure without deploying any of it: every template
 * shape a change can produce is synthesized and linted.
 *
 * No AWS credentials are needed, which is the point of the placeholder account
 * id — so this runs unchanged on a fork's pull request.
 */

/**
 * Packages and lints each shape, reports them, and fails on any that failed.
 *
 * @return {Promise<void>}
 */
async function main() {
  const config = resolveConfig();
  if (config.cwd !== '.') {
    process.chdir(config.cwd);
  }

  const shapes = resolveShapes(config);
  console.log(`Validating ${shapes.length} template shape(s) for ${config.stage}: ` +
    `${shapes.map((shape) => shape.label).join('; ')}.`);

  if (config.install) {
    await group('Install dependencies', () => runCommandLine(config.installCommand));
  }
  if (config.lint && config.installLint) {
    await group('Install cfn-lint', () => installCfnLint(config));
  }

  const results = [];
  for (const shape of shapes) {
    results.push(await group(`${shape.label}`, () => validateShape(config, shape)));
  }

  await updateCommentSection(config.section, renderComment(config, results), commentConfig());
  await summary(renderSummary(config, results));
  await publish(config, results);

  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    error(
      `${config.label} validation failed for ${failed.map((result) => result.label).join('; ')}.`
    );
    process.exitCode = 1;
  }
}

/**
 * Publishes the action's outputs.
 *
 * The template and findings paths go out as JSON lists, so a later step can
 * upload exactly what this run produced rather than globbing for it.
 *
 * @param {object} config Resolved configuration
 * @param {Array<object>} results Per-shape outcomes
 * @return {Promise<void>}
 */
async function publish(config, results) {
  await setOutput('outcome', results.every((result) => result.ok) ? 'passed' : 'failed');
  await setOutput('shapes', results.length);
  await setOutput('findings', results.reduce((total, result) => total + result.findings.length, 0));
  await setOutput('failed-shapes', results.filter((result) => !result.ok).map((result) => result.slug).join(','));
  await setOutput('template-paths', JSON.stringify(results.map((result) => result.templatePath).filter(Boolean)));
  await setOutput('findings-paths', JSON.stringify(results.map((result) => result.findingsPath)));
}

try {
  await main();
} catch (thrown) {
  error(failureMessage(thrown));
  await setOutput('outcome', 'failed');
  process.exitCode = 1;
}
