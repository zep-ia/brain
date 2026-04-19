# Source Material Modeling

## Why source material matters

`brain` is strongest when long-term memory is treated as the result of **controlled promotion**, not as a direct archive of every runtime event.

In operational systems, many useful memory inputs begin as **source material**:

- issue triage results
- implementation briefs
- pull request reviews
- findings and resolutions
- release evaluations
- operator or maintainer directives from chat systems

These inputs are often important, but they are **not automatically long-term memory**.

Instead, they act as structured inputs that short-term memory can repeatedly reference until hippocampal consolidation decides what should become durable memory.

## What counts as source material?

Source material is any structured operational artifact that may later contribute to memory formation.

Examples:

- an issue that repeatedly triggers follow-up reasoning
- a review finding that reappears across multiple PRs
- a release evaluation that surfaces recurring contradictions or duplication
- a maintainer directive that changes how future reviews should behave

A useful rule of thumb:

> source material is the raw or structured evidence that memory can be built from,
> but it is not necessarily memory itself.

## What is *not* long-term memory?

Long-term memory should usually **not** be a verbatim copy of:

- issue payloads
- PR payloads
- release notes
- full chat transcripts
- raw webhook events

Those artifacts may be essential inputs, but durable memory is typically a **promoted abstraction**, such as:

- a lesson
- a recurring pattern
- a durable rule
- an approved direction
- an operational warning that survives beyond one event

## Suggested mental model

A practical framing for operational systems is:

1. **Runtime authority** receives events and performs actions.
2. **Source material** captures structured operational artifacts.
3. **Short-term memory** repeatedly references source material during active work.
4. **Hippocampal consolidation** scores recurrence, centrality, and usefulness.
5. **Long-term memory** stores only the promoted abstraction.

This helps preserve an important distinction:

- source material explains **what happened**
- long-term memory explains **what should continue to matter**

## Repeated reference as a promotion signal

A helpful promotion heuristic is that source material should become memory only when it continues to matter.

Examples:

- the same class of review finding appears across multiple PRs
- a release retrospective reinforces a previously seen concern
- a maintainer directive is repeatedly referenced in later decisions
- an issue continues to influence design or review outcomes over time

In these cases, repeated reference can act as a consolidation signal that promotes a higher-level memory such as:

- “documentation mismatches reduce credibility”
- “scope-external blockers create review noise”
- “this subsystem tends to regress in the same boundary condition”

## Operator directives and routing

Chat-driven systems often receive messages that should not all be treated the same way.

A practical intake split is:

- **decision**: changes how the system should behave
- **memory**: should be retained as a potentially durable lesson or note
- **transient**: useful only for the current interaction

This distinction is especially useful in maintainer workflows where operator messages may include:

- review policy overrides
- temporary release guidance
- durable project principles
- ordinary conversational coordination

## Maintainer workflow example

A maintainer/review workflow often looks like:

`issue -> implementation brief -> PR -> review -> release -> retrospective`

Across that flow:

- issues, briefs, reviews, release evaluations, and directives all function as source material
- short-term memory can reference them during active work
- consolidation can promote only the patterns that survive repeated reuse

## Why this is worth documenting

The `brain` model becomes especially compelling when memory is treated as a promotion system over meaningful source material rather than a passive archive.

Making that distinction explicit can help operational adopters avoid collapsing:

- runtime events
- structured artifacts
- short-term reasoning context
- durable memory

into a single undifferentiated memory store.
