import {argsInput, booleanInput, input, intInput, listInput, rawInput} from './inputs.mjs';
import {parseShapes}                                                  from './shapes.mjs';

/**
 * The action's inputs, resolved into one object.
 */

/**
 * Resolves every input.
 *
 * @return {object} Resolved configuration
 */
export function resolveConfig() {
  return {
    stage: input('stage', 'dev'),
    configFile: input('config-file', 'serverless.yml'),
    mainRegion: input('main-region'),
    mainRegionKey: input('main-region-key', 'mainRegion'),
    secondaryRegion: input('secondary-region'),
    validationSecondaryRegion: input('validation-secondary-region'),
    secondaryRegionVariable: input('secondary-region-variable', 'SECONDARY_REGION'),
    shapes: parseShapes(rawInput('shapes')),
    install: booleanInput('install', true),
    installCommand: input('install-command', 'npm ci'),
    packageCommand: input('package-command', 'npx osls package'),
    packageArgs: argsInput('package-args'),
    templatePath: input('template-path', '.serverless/cloudformation-template-update-stack.json'),
    lint: booleanInput('cfn-lint', true),
    installLint: booleanInput('install-cfn-lint', true),
    lintCommand: input('cfn-lint-command', 'cfn-lint'),
    lintArgs: argsInput('cfn-lint-args'),
    lintVersion: input('cfn-lint-version'),
    nonZeroExitCode: input('non-zero-exit-code', 'warning'),
    accountId: input('account-id', '000000000000'),
    extraEnv: parseEnv(listInput('extra-env')),
    maxListed: intInput('max-findings-listed', 15),
    label: input('label', 'Infrastructure'),
    section: input('comment-section', 'infra'),
    cwd: input('working-directory', '.')
  };
}

/**
 * Reads the extra template variables a caller passes, as `KEY=value` lines.
 *
 * They exist because a serverless configuration reads its own environment: a
 * template that resolves a variable at package time cannot be synthesized
 * without it, and the alternative to passing them here is a caller who cannot
 * use the action at all.
 *
 * @param {string[]} entries The `KEY=value` entries
 * @return {Record<string, string>} The environment to add
 */
export function parseEnv(entries) {
  const env = {};
  for (const entry of entries) {
    const index = entry.indexOf('=');
    if (index > 0) {
      env[entry.slice(0, index).trim()] = entry.slice(index + 1).trim();
    }
  }
  return env;
}

/**
 * The environment one shape is packaged with.
 *
 * The secondary-region variable is set for every shape, **empty included**: a
 * value left over in the runner's environment would otherwise leak into the
 * single-region template and make that shape a copy of the other one.
 *
 * @param {object} config Resolved configuration
 * @param {{ secondary: string }} shape The shape being packaged
 * @return {Record<string, string>} The environment for this package run
 */
export function shapeEnv(config, shape) {
  return {
    ...config.extraEnv,
    [config.secondaryRegionVariable]: shape.secondary,
    // A placeholder account id, so the configuration prefers it over an
    // `${aws:accountId}` lookup that would call STS. Account ids only ever
    // appear inside ARNs, so the template's shape is the one a real deploy
    // builds — and the job needs no AWS credentials, which is what lets it run
    // on a fork's pull request.
    AWS_ACCOUNT_ID: config.accountId
  };
}
