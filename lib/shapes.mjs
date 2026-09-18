import {readFileSync} from 'node:fs';
import {ConfigError}  from './inputs.mjs';

/**
 * Which templates a change can produce.
 *
 * A serverless configuration is not one document. Resources are conditional on
 * the region — a global table's replica exists in one and not the other — and
 * on whether the stage has a second region at all, which is an environment
 * variable rather than anything in the repository. Packaging the default shape
 * alone therefore proves the least interesting of them: the failure that
 * matters is the `Fn::GetAtt` against a resource the *other* region does not
 * create, and nothing but synthesizing that region finds it.
 */

/**
 * The region the configuration is built around.
 *
 * Read out of the configuration file when the caller names none, so the file
 * and the check cannot disagree about it. Never parsed as YAML: the file is
 * full of `${...}` that no plain parser resolves.
 *
 * @param {{ mainRegion: string, configFile: string, mainRegionKey: string }} config Resolved configuration
 * @return {string} The main region
 * @throws {ConfigError} When neither the input nor the file supplies one
 */
export function mainRegion({mainRegion: named, configFile, mainRegionKey}) {
  if (named) {
    return named;
  }

  let text;
  try {
    text = readFileSync(configFile, 'utf8');
  } catch {
    throw new ConfigError(
      `No \`main-region\` given and ${configFile} could not be read. Pass the region, ` +
      'or point `config-file` at the configuration.'
    );
  }

  const found = text.match(new RegExp(`^\\s+${mainRegionKey}:\\s*(\\S+)\\s*$`, 'm'))?.[1];
  if (!found) {
    throw new ConfigError(
      `No \`main-region\` given and no \`${mainRegionKey}:\` in ${configFile}. Pass the region, ` +
      `or add \`${mainRegionKey}:\` under the file's \`custom:\` block.`
    );
  }
  return found;
}

/**
 * The shapes to synthesize.
 *
 * With one region there is one shape and nothing to compare. With two there are
 * three, and each is a genuinely different document: the main region without a
 * replica, the main region with one, and the secondary region itself.
 *
 * @param {object} config Resolved configuration
 * @return {Array<{ label: string, slug: string, region: string, secondary: string }>} Shapes, in the order they are validated
 * @throws {ConfigError} When the secondary region is the main one
 */
export function resolveShapes(config) {
  if (config.shapes) {
    return config.shapes;
  }

  const main = mainRegion(config);
  const secondary = config.secondaryRegion || config.validationSecondaryRegion;

  if (secondary === main) {
    throw new ConfigError(
      `The secondary region is "${secondary}", which is already the main region. ` +
      'Leave it blank for a single-region stage.'
    );
  }

  if (!secondary) {
    return [{label: main, slug: main, region: main, secondary: ''}];
  }

  return [
    {label: `${main}, no replica`, slug: `${main}-single`, region: main, secondary: ''},
    {label: `${main}, replica in ${secondary}`, slug: `${main}-replicated`, region: main, secondary},
    {label: secondary, slug: secondary, region: secondary, secondary}
  ];
}

/**
 * Reads the shapes a caller listed explicitly, for a configuration whose
 * conditional resources this action cannot guess at.
 *
 * @param {string} json A JSON array of `{label?, slug?, region, secondary?}`
 * @return {Array<{ label: string, slug: string, region: string, secondary: string }>|null} The shapes, or null when the caller listed none
 * @throws {ConfigError} When the value is not a usable list
 */
export function parseShapes(json) {
  if (!json || json.trim() === '' || json.trim() === 'auto') {
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (thrown) {
    throw new ConfigError(`The \`shapes\` input is not valid JSON: ${thrown.message}`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new ConfigError('The `shapes` input must be a non-empty JSON array of objects with a `region`.');
  }

  return parsed.map((shape, index) => {
    if (!shape?.region) {
      throw new ConfigError(`Shape ${index} in the \`shapes\` input has no \`region\`.`);
    }
    const secondary = shape.secondary ?? '';
    return {
      label: shape.label || (secondary ? `${shape.region}, replica in ${secondary}` : shape.region),
      slug: shape.slug || `${shape.region}${secondary ? '-replicated' : ''}`,
      region: shape.region,
      secondary
    };
  });
}
