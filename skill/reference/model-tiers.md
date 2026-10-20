# Model tiers

Paseo gives no tier for a model: `paseo provider models <provider>` lists only a name and a one-line
description (add `--json`). Judge the tier yourself with this guide, whatever the provider. Models
of different providers are comparable by tier.

| Tier | Meaning | Examples |
| --- | --- | --- |
| top | the strongest, for hard or risky work | Opus, Fable, GPT Astra |
| middle | everyday work, routine implementation | Sonnet, GPT Sol, GPT terra, Gemini Pro, Grok |
| cheapest | quick, mechanical work | Haiku, GPT luna, Gemini Flash |

A newer or older version keeps its family's tier. For a model not listed, go by the description the
provider gives ("fast and affordable", "frontier", "everyday"); if it still does not place the model,
treat it as not cheaper than anything.

## Stepping down to a cheaper model

- Choose only from the models the project allows (the owner's model for a manager's pick; the
  allowed subagent models, or the owner's own model when that list is empty, for an owner's pick).
  Never use a model outside it, and never assume Sonnet or Haiku exist.
- **Cheaper** means a lower tier than the model you step down from; the same tier is not cheaper.
- Among cheaper allowed models, prefer one of the same provider; otherwise take the nearest cheaper
  one of any provider the project allows (an Opus owner, with only GPT terra allowed below it, uses
  terra for easy work).
- No cheaper allowed model: keep the model you have.

## Matching the task

- **Mechanical** means the what is fully decided: about 150 lines written or fewer, at most two
  components, fast tests, and the tests given as named tests with exact values or as code. Typical:
  a project skeleton and its config, stubs, a thin wrapper over a given interface, a constant table,
  a small pure function with a crisp spec, docs from existing code. Never mechanical: a parser, an
  evaluator, a server, UI, anything with state, a protocol or security, or an unclear spec.
  Mechanical work goes to the cheapest allowed tier.
- **Routine design** goes to the middle tier; **risky or hard** work to the top tier.
- **Never the cheapest** for a fix, a review or an investigation: each needs judgement, and
  cheapest-tier reviewers have caught none of ten planted defects in a measured run.
- **A miss goes up:** a task the cheapest tier got wrong goes to a **fresh** agent one tier up with
  a fix note (`templates/fix-note.md`), never retried at the same tier.
- The step-down rules below still decide which allowed model fills a tier.
