# aws-osls-action

Synthesizes **every** CloudFormation template a serverless configuration can
produce, lints each one, and reports them — without deploying anything and
without AWS credentials.

```yaml
- uses: actions/checkout@v7
- uses: actions/setup-node@v7
  with:
    node-version: 'lts/*'
    cache: npm
- uses: actions/setup-python@v6      # cfn-lint is a Python package
  with:
    python-version: '3.x'

- uses: malyavi/aws-osls-action@v1
  with:
    stage: dev
    validation-secondary-region: us-west-1
```

Built for [osls](https://github.com/oss-serverless/serverless), and
`package-command` points it at any packager that takes `--stage` and `--region`
and leaves a template on disk.

## Why more than one template

A serverless configuration is not one document. Resources are conditional on
the region — a global table's replica exists in one and not the other — and on
whether the stage has a second region at all, which is an environment variable
rather than anything in the repository. Packaging the default shape therefore
proves the least interesting of them. The failure that matters is the
`Fn::GetAtt` against a resource the *other* region does not create, and nothing
but synthesizing that region finds it.

So with a secondary region in play this action validates three shapes:

| Shape | What it is |
| --- | --- |
| `<main>-single` | The main region with no replica — a single-region stage. |
| `<main>-replicated` | The main region with a replica in the secondary. |
| `<secondary>` | The secondary region itself. |

The secondary-region variable is set for **every** shape, empty included: a
value left over in the runner's environment would otherwise leak into the
single-region template and make it a copy of the replicated one. The smoke test
asserts exactly that.

With one region there is one shape, and with `shapes` you can list your own.

## Two passes per shape

1. **Packaging** resolves every `${...}`, bundles the handlers and synthesizes
   the template. This catches an undefined variable, a handler path that names
   nothing, a plugin that is in the configuration but not in `package.json`, and
   any import that does not bundle.
2. **cfn-lint** reads the result against the resource schemas. This catches a
   property CloudFormation does not have, a wrong type, and a `DependsOn` or
   `Ref` pointing at a logical id that is not there. Packaging is happy with all
   of those.

Warnings fail by default (`non-zero-exit-code: warning`), on the grounds that a
template which starts clean should stay clean and the one warning that is by
design is easier to silence in `.cfnlintrc.yaml`, with a note saying why, than
to notice among ten that are not.

## No AWS credentials

`account-id` is a placeholder the configuration prefers over an
`${aws:accountId}` lookup that would call STS. Account ids appear only inside
ARNs, so the template's shape is the one a real deploy builds — and the job runs
on a fork's pull request.

## Inputs

| Input | Default | What it does |
| --- | --- | --- |
| `stage` | `dev` | Decides resource names, never the shape of the template. |
| `config-file` | `serverless.yml` | Read for the main region; never parsed as YAML. |
| `main-region` | from the config file | The region the configuration is built around. |
| `main-region-key` | `mainRegion` | The key it is read from, under `custom:`. |
| `secondary-region` | — | The stage's second region, if it has one. |
| `validation-secondary-region` | — | A second region to use when the stage names none — which is what a pull request job sees. |
| `secondary-region-variable` | `SECONDARY_REGION` | The variable the configuration reads it from. |
| `shapes` | derived | A JSON array of `{region, secondary?, label?, slug?}` to validate instead. |
| `install` | `true` | Whether to install dependencies first. |
| `install-command` | `npm ci` | How to install them. |
| `package-command` | `npx osls package` | `--stage` and `--region` are appended. |
| `package-args` | — | Extra arguments for it. |
| `template-path` | `.serverless/cloudformation-template-update-stack.json` | Where the packager leaves the template. |
| `cfn-lint` | `true` | Whether to lint each template. |
| `install-cfn-lint` | `true` | Whether to install cfn-lint with pip. |
| `cfn-lint-version` | newest | Version to install. |
| `cfn-lint-command` | `cfn-lint` | How to invoke it. |
| `cfn-lint-args` | — | Extra arguments, for example `--ignore-checks W3045`. |
| `non-zero-exit-code` | `warning` | The severity that fails the run. Empty leaves cfn-lint's own default. |
| `account-id` | `000000000000` | The placeholder that keeps STS out of it. |
| `extra-env` | — | `KEY=value` entries the configuration resolves at package time. |
| `max-findings-listed` | `15` | Findings named in the comment before collapsing into a count. |
| `label` | `Infrastructure` | How the check names itself. |
| `working-directory` | `.` | Directory holding the configuration. |
| `comment`, `comment-section`, `comment-tag`, `comment-section-order`, `pr-number`, `github-token` | | The shared comment. |

## Outputs

| Output | What it holds |
| --- | --- |
| `outcome` | `passed` or `failed`. |
| `shapes` | How many template shapes were validated. |
| `findings` | Findings across every shape, warnings included. |
| `failed-shapes` | The slugs of the shapes that failed, comma-separated. |
| `template-paths` | A JSON array of the synthesized templates, one per shape. |
| `findings-paths` | A JSON array of the cfn-lint reports, one per shape. |

Each template is copied to `cloudformation-template-<slug>.json`, because
packaging overwrites one path — without the copy a reviewer can only read the
last template a run produced, and the one they want is usually an earlier one.
Upload them for a reviewer who would rather read the CloudFormation than infer
it from the configuration:

```yaml
- uses: actions/upload-artifact@v7
  if: always()
  with:
    name: cloudformation-templates
    path: |
      cloudformation-template-*.json
      cfn-lint-*.json
    if-no-files-found: ignore
```

## Development

```bash
npm test                           # unit suite, no dependencies
python3 test/check-action-yaml.py  # action.yml parses and maps every input
```

The smoke job runs **cfn-lint for real** against templates written by a stand-in
packager, which asserts the contract this action owns — that `--stage` and
`--region` arrive, and that the secondary-region variable is set for every shape
— and then writes one broken template and two sound ones. Whether `osls package`
can synthesize a real configuration is the caller's tool doing the caller's job.
