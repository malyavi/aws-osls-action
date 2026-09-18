import {mkdir, writeFile} from 'node:fs/promises';
import {dirname}          from 'node:path';

/**
 * A stand-in for `osls package`, for the smoke test.
 *
 * It stands in for the packager and for nothing else: it **asserts the
 * contract** the action is responsible for — that `--stage` and `--region`
 * arrive, and that the secondary-region variable is set for every shape,
 * empty included — and then writes a template. What `osls package` itself does
 * with a real configuration is the caller's tool doing the caller's job, and
 * installing a hundred megabytes of it here would test that rather than this.
 *
 * The template it writes depends on the region, so a run of three shapes has
 * one that fails cfn-lint and two that do not. That is what makes the smoke
 * test's assertions about *which* shape failed mean something.
 */

const args = process.argv.slice(2);

/**
 * The value of a named argument.
 *
 * @param {string} name Argument name, with its dashes
 * @return {string|undefined} The value that followed it
 */
function valueOf(name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

/**
 * Fails the run with a message the smoke job's log will carry.
 *
 * @param {string} message What was wrong
 * @return {never}
 */
function refuse(message) {
  console.error(`fake-package: ${message}`);
  console.error(`fake-package: argv was ${JSON.stringify(args)}`);
  process.exit(1);
}

const stage = valueOf('--stage');
const region = valueOf('--region');

if (!stage) {
  refuse('the action did not pass --stage');
}
if (!region) {
  refuse('the action did not pass --region');
}
if (process.env.SECONDARY_REGION === undefined) {
  // Set for every shape or the single-region template silently inherits
  // whatever the runner happened to hold.
  refuse('SECONDARY_REGION was not set at all; it must be set for every shape, empty included');
}
if (process.env.AWS_ACCOUNT_ID !== '000000000000' && !process.env.AWS_ACCOUNT_ID) {
  refuse('AWS_ACCOUNT_ID was not set, so the configuration would have called STS');
}

const template = {
  AWSTemplateFormatVersion: '2010-09-09',
  Description: `fixture ${stage} ${region} secondary=${process.env.SECONDARY_REGION || 'none'}`,
  Resources: {
    Topic: {
      Type: 'AWS::SNS::Topic',
      Properties: {TopicName: `fixture-${stage}-${region}`}
    },
    // us-west-1 gets a reference to a resource that does not exist, which is
    // exactly the class of mistake packaging accepts and cfn-lint catches.
    ...(region === 'us-west-1'
      ? {Alarm: {Type: 'AWS::SNS::Subscription', Properties: {Protocol: 'sqs', TopicArn: {Ref: 'Topic'}, Endpoint: {'Fn::GetAtt': ['MissingQueue', 'Arn']}}}}
      : {})
  }
};

const out = process.env.FAKE_TEMPLATE_PATH || '.serverless/cloudformation-template-update-stack.json';
await mkdir(dirname(out), {recursive: true});
await writeFile(out, JSON.stringify(template, null, 2));
console.log(`fake-package: wrote ${out} for ${stage}/${region} (secondary="${process.env.SECONDARY_REGION}")`);
