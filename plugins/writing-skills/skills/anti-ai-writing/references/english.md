# English expression checks

Read [SKILL.md](../SKILL.md) for shared principles and the checking workflow. These are editing prompts, not evidence that a text was written by AI.

## Punctuation and formatting

- Replace em dashes with a sentence break, comma, or parentheses as appropriate.
- Use emphasis sparingly. A bold label on every sentence does not make the argument clearer.
- Colons before lists and nested quotations can be normal English. Do not import Japanese punctuation rules into English.
- Keep necessary qualifications in the sentence rather than accumulating parenthetical asides.

## Vocabulary and phrasing

- Replace stock openings such as "In today's fast-paced world" with the specific situation.
- Check "It is important to note that" and "In conclusion": often the sentence works without the announcement.
- Avoid decorative phrases such as "delve into", "unlock the potential of", and "game-changer" when a direct verb or concrete result would say more.
- Check promotional words such as "seamlessly", "groundbreaking", and "revolutionary" against the evidence. Describe what changed and for whom.
- Prefer a precise everyday verb to an inflated one. "Use" often works better than "utilize"; "leverage" should not stand in for an unexplained action.
- Do not repeatedly frame claims as "not just X, but also Y". Say what the distinction contributes.
- Preserve technical terms, proper names, and literal meanings. A word on a watch list is not automatically wrong.

## Rhythm and voice

- Avoid opening three consecutive sentences with the same two words. Recast the argument rather than swapping in synonyms mechanically.
- Remove unnecessary "Furthermore", "Moreover", "Additionally", and "Therefore". The relationship should usually be apparent from the content.
- Vary sentence and paragraph length where the argument calls for it. Do not make every section a claim, three bullets, and a recap.
- Use contractions and conversational phrasing only when they fit the audience. Do not add slang or fabricated personal anecdotes to sound human.
- State a recommendation and its reason instead of ending with a generic balance of pros and cons. Keep genuine uncertainty.

## Script coverage

Enabled with `--language en` or `both`. The shared `common.em-dash` check also runs. Phrase matching is case-insensitive and uses word boundaries.

| Rule ID | What it flags |
| --- | --- |
| `en.boilerplate` | Stock openings and announcements |
| `en.cliche` | "Delve into", "unlock the potential/power of", "game-changer" |
| `en.inflated` | Promotional or inflated vocabulary |
| `en.not-only` | "Not just/only ... but also ..." within one line |
| `en.repeated-opening` | Three consecutive sentences with the same first two words in one paragraph |
| `en.connective-overuse` | Two or more listed sentence-opening connectors in one paragraph |

Sentence boundaries are approximated from punctuation, not parsed linguistically. Abbreviations and quotations can produce false positives. Review the original text before changing it.

The script cannot determine whether a claim is supported, a metaphor is useful, or a tone suits the reader. A clean result does not replace a full read-through.
