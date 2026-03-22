# Style Guide

This document is the working reference for adding or updating image styles in Leaderbot.

The goal is consistency. As the style catalog grows, we should not rely on memory or taste alone to keep previews and prompts aligned.

## When to use this

Use this guide whenever you:

- add a new style
- update an existing style prompt
- regenerate a style preview thumbnail
- review a PR that changes style previews or style metadata

## Definition of done for a new style

A style is only ready when all of the following are true:

- the style has a clear visual identity that is easy to distinguish from other styles
- the preview looks good at small mobile sizes
- the prompt is specific enough to reproduce the intended look consistently
- the naming is consistent across code, preview assets, and manifest data
- the preview asset is committed in the expected location
- the change has been compared against nearby styles for overlap or redundancy

## Quality bar

Every style preview should pass these checks:

- Strong silhouette: the subject should read clearly at a glance
- Clear focal point: avoid muddy compositions with no obvious center
- Small-screen readability: the preview must still feel intentional when viewed as a compact card
- Controlled background: background can support the style, but should not drown the subject
- Distinct palette or mood: users should quickly understand what makes the style different
- Stable composition: avoid previews that only work because of one lucky crop
- Consistent polish: new styles should feel as finished as the existing best styles, not like experiments

## Prompt-writing rules

When creating or refining a style prompt:

- Lead with the core visual identity first
- Be concrete about wardrobe, lighting, framing, and mood
- Prefer visual direction over vague adjectives
- Avoid stacking too many competing ideas in one prompt
- Optimize for reproducibility, not just a single good sample
- If the preview is meant for mobile, say so explicitly when helpful

Good prompt qualities:

- specific
- visual
- composable
- reproducible

Weak prompt qualities:

- generic
- overloaded
- dependent on luck
- too subtle to read in a thumbnail

## Preview rules

Preview images should:

- represent the style honestly
- be centered and readable in thumbnail form
- avoid edge-cropped faces or confusing poses
- avoid text-heavy or detail-heavy compositions that collapse on mobile
- feel balanced next to the existing preview set

If a style only looks good in full resolution but weak as a thumbnail, it is not ready yet.

## Naming and asset conventions

Keep naming consistent everywhere:

- use kebab-case for style ids
- use the same id in filenames and metadata where applicable
- keep preview files in `public/style-previews/`
- keep metadata in `public/style-previews/manifest.json`

Before merging, verify:

- the preview filename matches the style id
- the manifest entry points at the correct output path
- any prompt-specific metadata uses the same style id naming

## Review checklist

Before approving a new style, check:

- Is this style visually distinct from the current set?
- Does the preview still work when viewed very small?
- Is the subject clear within one second of looking?
- Is the prompt specific enough for future regeneration?
- Is the crop intentional rather than accidental?
- Does the style feel production-ready rather than exploratory?
- Are file naming and manifest updates consistent?

## PR expectations

For style-related changes, include:

- the style name or id
- what changed
- whether the prompt changed, the preview changed, or both
- any tradeoff worth noting, especially if the style is intentionally more subtle than usual

## Practical workflow

Recommended workflow for adding a style:

1. Draft the style concept in one sentence.
2. Write a prompt that emphasizes the defining visual traits.
3. Generate or refine preview candidates.
4. Pick the candidate that reads best at thumbnail size, not just at full size.
5. Add the preview asset and metadata.
6. Compare it against the existing style set for overlap and consistency.
7. Do one final small-size sanity check before merging.

## Tie-breaker rule

If there is a choice between:

- a preview that is more artistic
- a preview that is clearer and more consistent

Choose the clearer and more consistent preview.

## Maintenance note

This document should evolve with the style system. If we notice repeated review comments or recurring quality issues, update this guide in the same PR that addresses them.
