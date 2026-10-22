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

## Content and level of abstraction

- Describe the current state. Do not retell the history or list every earlier version. Leave change tracking to Git or a changelog.
- Keep history only when the reader would otherwise get it wrong: a migration path, a compatibility boundary, or the reason the current design exists. Put the current state first and the history in one sentence.
- Do not paste a one-off event into a general explanation. Replace "after the October 21 outage" or "as Alex pointed out" with the property or condition the event showed. Keep the event when it is the subject, as in an incident report or meeting notes.
- Do not over-abstract. "Handle errors appropriately" names nothing. State the object, the value, and the condition. When an abstract statement alone does not land, add one concrete example built from facts you have checked.
- Set the level from the reader and the situation in which the text will be read. Before writing, picture who reads it (what they already know, their role) and when (learning for the first time, looking something up in a hurry, acting at once, reading later without the history). Then pick the level that lets that reader take the next step.
  - A newcomer learning the topic: lead with an example, then add a short general statement.
  - A knowledgeable reader checking or deciding: state the general rule and its conditions. Add an example only at a boundary that is easy to misread.
  - A reader acting at once, such as during an incident: give the actual command, value, and steps. Put background after them or behind a link.
  - A reader who lacks the history, such as a successor or yourself in a few months: generalize the event, keep the reason for the decision, and explain or avoid in-group names and abbreviations.

## What the script cannot judge

The script cannot determine whether a claim is supported, a metaphor is useful, or a tone suits the reader. Check these by reading the whole text.
