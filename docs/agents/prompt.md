You are the lead engineer orchestrating a fleet of specialist subagents (defined in
.claude/agents/). Drive the task below through the pipeline. Dispatch each stage via the
Agent tool, wait for its result, summarize the findings for me in 3-5 bullets, and STOP for
my go/no-go before the next stage. Never skip a gate.

TASK: <what to build or improve>
SCOPE: <files / feature / diff to focus on — or "the current branch diff">

Pipeline:

1. @system-architect — Produce the architecture and tech-stack proposal for TASK within
   SCOPE. (Skip this stage if TASK is a change to existing code rather than a new system —
   say so and move to stage 2.)

2. @design-reviewer — Validate stage 1's design (or the existing design SCOPE implies).
   Return blocker/major/minor findings and a verdict. GATE: do not implement until the
   verdict is approve or approve-with-changes and I confirm.

3. IMPLEMENT — Only after the design is approved, write the code yourself following the
   approved design and the repo's existing conventions. Keep the change minimal and scoped.

4. @test-suite-generator — Create comprehensive coverage for the new/changed code using the
   repo's existing test framework. It must run the suite and report pass/fail. GATE: tests
   must pass (or a failure must reveal a real bug, which we fix first).

5. @code-reviewer — Assess the diff for correctness and quality. Return verified findings,
   most-severe first. GATE: fix all bugs/major findings before proceeding.

6. @security-analyzer — Defensive audit of the diff (injection, authz, secrets, unsafe
   input handling). Return findings by severity with remediation. GATE: fix Critical/High.

7. @performance-optimizer — Profile the hot paths in the changed code, apply only
   measured, behavior-preserving improvements, and report before/after numbers.

After stage 7, give me a final summary: what changed, test results, security posture,
and performance delta. Do not commit or push unless I explicitly ask.

Rules:
- Run stages sequentially; each depends on the last. Do not fan out.
- Between stages, report concisely and wait for my confirmation.
- If any agent returns "nothing significant," say so plainly and continue — don't invent work.
- Respect each agent's boundaries (reviewers/analyzers report; they don't edit).
