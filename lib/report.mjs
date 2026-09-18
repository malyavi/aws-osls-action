import {tail} from './core.mjs';

/**
 * What a reader is told: one line per shape in the comment, every finding in
 * the job summary.
 *
 * A passing run's warnings go in the summary too. They are not failures — the
 * exit threshold decides that — but a template that has started warning is
 * worth seeing before the warning becomes the next release's error.
 */

/** Lines of a failed command's output reproduced in a report. */
export const MAX_OUTPUT_LINES = 30;

/**
 * The comment section.
 *
 * @param {{ label: string, stage: string, maxListed: number }} config How the check is named
 * @param {Array<object>} results Per-shape outcomes
 * @return {string} Markdown
 */
export function renderComment(config, results) {
  const ok = results.every((result) => result.ok);
  const lines = [
    ok
      ? `:white_check_mark: **${config.label} valid** (${config.stage}): packaged and linted for ` +
        `${results.map((result) => `\`${result.label}\``).join(', ')}.`
      : `:x: **${config.label} invalid** (${config.stage}):`
  ];

  for (const result of results.filter((entry) => !entry.ok)) {
    lines.push('', `**${result.label}** — failed at \`${result.step}\``);
    for (const finding of result.findings.slice(0, config.maxListed)) {
      lines.push(`- \`${finding.Rule?.Id}\` ${finding.Message} (${location(finding)})`);
    }
    if (result.findings.length > config.maxListed) {
      lines.push(`- …and ${result.findings.length - config.maxListed} more`);
    }
    if (result.detail) {
      lines.push('', '```', result.detail, '```');
    }
  }

  if (!ok) {
    lines.push('', `Full output is in the "${config.label}" job log and its step summary.`);
  }
  return lines.join('\n');
}

/**
 * The job summary: every shape, and every finding it produced.
 *
 * @param {{ label: string, stage: string }} config How the check is named
 * @param {Array<object>} results Per-shape outcomes
 * @return {string} Markdown
 */
export function renderSummary(config, results) {
  const ok = results.every((result) => result.ok);
  const lines = [`## ${ok ? ':white_check_mark:' : ':x:'} ${config.label} (${config.stage})`];

  for (const result of results) {
    const verdict = result.ok ? 'packaged and linted clean' : `failed at \`${result.step}\``;
    lines.push('', `### \`${result.label}\` — ${verdict}`);

    if (result.findings.length > 0) {
      lines.push('', '| Rule | Level | Where | Message |', '| --- | --- | --- | --- |');
      for (const finding of result.findings) {
        lines.push(`| \`${finding.Rule?.Id}\` | ${finding.Level} | ${location(finding)} | ${finding.Message} |`);
      }
    }
    if (result.detail) {
      lines.push('', '```', result.detail, '```');
    }
  }
  return lines.join('\n');
}

/**
 * Where a finding sits, as a short human reference.
 *
 * The resource path when there is one, because a logical id is what a reader
 * searches the configuration for; a line number otherwise, which is all a
 * parse failure has.
 *
 * @param {object} finding One cfn-lint finding
 * @return {string} A resource path or a line number
 */
export function location(finding) {
  const path = finding.Location?.Path;
  return Array.isArray(path) && path.length > 0
    ? `\`${path.join('.')}\``
    : `line ${finding.Location?.Start?.LineNumber ?? '?'}`;
}

/**
 * The tail of a command's output, which is where the reason for a failure is.
 *
 * @param {string} output Captured output
 * @return {string} At most MAX_OUTPUT_LINES lines
 */
export function outputTail(output) {
  return tail(output, MAX_OUTPUT_LINES);
}
