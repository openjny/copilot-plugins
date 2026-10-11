---
name: plan-skill
description: "Iterative planning methodology that drives Discovery → Alignment → Design → Refinement to produce a comprehensive actionable plan. Covers both technical implementation and non-technical projects. NEVER executes — only plans. Use when: a task has multiple steps, trade-offs, or unknowns worth resolving upfront. Triggers: 計画して、整理して、plan before starting, 段階的に進めたい"
---

Follow this planning methodology to create a detailed, actionable plan with the user.

Research context → clarify with the user → capture findings and decisions into a comprehensive plan. This iterative approach catches edge cases and non-obvious requirements BEFORE execution begins.

This methodology is strictly for planning. NEVER start implementation before the user approves the plan.

**Current plan**: Use the host's session-memory or plan-persistence tool when available. Do not assume a tool name or a fixed filesystem path. If no such tool is available, keep the plan in the conversation, present it in full, and explicitly state that it has not been saved separately.

<rules>
- Do not edit project files, run implementation commands, or create artifacts as a workaround for missing plan-persistence tools. Plans are for others to execute. The only permitted write is saving the plan through the host's dedicated plan or session-memory tool.
- Use the available user-question tool (such as ask_user or askQuestions) to clarify requirements. Do not assume a specific tool name. If no question tool exists, ask in the conversation and wait for the answer.
- Present a well-researched plan with loose ends tied BEFORE implementation
</rules>

<workflow>
Cycle through these phases based on user input. This is iterative, not linear. If the user task is highly ambiguous, do only *Discovery* to outline a draft plan, then move on to alignment before fleshing out the full plan.

## 1. Discovery

Gather context, analogous precedents, blockers, and ambiguities with read-only tools. Follow the host's delegation rules: handle simple lookups directly; use read-only subagents only for substantial independent research when supported and permitted. Do not require a particular agent name or count.

Update the plan with your findings.

## 2. Alignment

If research reveals major ambiguities or if you need to validate assumptions:
- Use the available user-question mechanism to clarify intent with the user.
- Surface discovered technical constraints or alternative approaches
- If answers significantly change the scope, loop back to **Discovery**

## 3. Design

Once context is clear, draft a comprehensive actionable plan.

The plan should reflect:
- Structured concise enough to be scannable and detailed enough for effective execution
- Step-by-step actions with explicit dependencies — mark which steps can run in parallel vs. which block on prior steps
- For plans with many steps, group into named phases that are each independently verifiable
- Verification steps for validating outcomes, both automated and manual
- Critical resources to reference or modify — reference specific artifacts, patterns, or examples, not just file names
- Key files or assets involved (with full paths where applicable)
- Explicit scope boundaries — what's included and what's deliberately excluded
- Reference decisions from the discussion
- Leave no ambiguity

Save the comprehensive plan through the host's plan-persistence mechanism if available, then show the scannable plan to the user for review. Always show the plan: persistence is not a substitute for presenting it. If saving is unavailable, state that explicitly without creating project files.

## 4. Refinement

On user input after showing the plan:
- Changes requested → revise and present the updated plan. Keep any host-managed saved plan in sync.
- Questions asked → clarify, or use #tool:vscode/askQuestions for follow-ups
- Alternatives wanted → loop back to **Discovery**, using delegation only where appropriate.
- Approval given → acknowledge and hand off to implementation if the host supports it. Do not start implementation while this planning skill is active.

Keep iterating until explicit approval or handoff.
</workflow>

<plan_style_guide>
```markdown
## Plan: {Title (2-10 words)}

{TL;DR - what, why, and how (your recommended approach).}

**Steps**
1. {Action step-by-step — note dependency ("*depends on N*") or parallelism ("*parallel with step N*") when applicable}
2. {For plans with 5+ steps, group steps into named phases with enough detail to be independently actionable}

**Relevant files**
- `{full/path/to/file}` — {what to modify or reuse, referencing specific functions/patterns}

**Verification**
1. {Verification steps for validating the implementation (**Specific** tasks, tests, commands, MCP tools, etc; not generic statements)}

**Decisions** (if applicable)
- {Decision, assumptions, and includes/excluded scope}

**Further Considerations** (if applicable, 1-3 items)
1. {Clarifying question with recommendation. Option A / Option B / Option C}
2. {…}
```

Rules:
- NO code blocks — describe changes, link to files and specific symbols/functions
- NO blocking questions at the end — ask during the workflow through the available question mechanism.
- The plan MUST be presented to the user, don't just mention the plan file.
</plan_style_guide>
