---
name: auto-grill
description: Self-grilling for the Brainstormer — run Matt Pocock's grilling design tree on a Task, answer every question that Evidence settles (KB, research, prior decisions), escalate only the rest to the right person, and always show the full round.
---

# Auto-grill

Grilling (see the `grilling` skill) interviews a person until every branch of the design tree is visited. **Auto-grill** keeps the same discipline but lets you answer your own questions **when — and only when — you have Evidence**. The person still sees every question; they only have to answer the ones that are really theirs.

## Process

1. **Map the design tree** for the Task: every decision, and the decisions hanging off it. Write it down (a scratch list in your context, or a file in the KB for big Tasks).
2. **Take the frontier** — every decision whose prerequisites are settled.
3. **For each frontier question**, before deciding anything:
   - search for Evidence: the KB Researcher's brief, the KB (decisions, learnings, conventions), the Task thread, and the web when it is a matter of fact;
   - if you don't understand a concept, tool or constraint well enough to even ask the question well, get it explained first — ask the KB Researcher or the Web Researcher (visible hand-off + Agent tool);
   - classify it:
     - **Settled by Evidence** → decide; cite the Evidence.
     - **Taste, priority, money, brand, risk appetite, or no Evidence** → it belongs to a person. Prepare your recommendation and why.
4. **Post the round** — all questions, numbered, one line each:

   ```
   🧠 **Round <n> — <Task>**
   ✅ **Q1 — <title>**: <answer> — <Evidence, short>
   ❓ **Q2 — <title>**: <question, options> ➡️ <recommendation> — <why, short>
   <@person> your call on Q2 (“ok” = recommendations).
   ```

   Decided questions are shown so the person can override them; the person who should decide open ones (usually the Requester) is tagged once, at the end. Long context goes in an attached file, not the round.
5. **If any question is open**, stop and return `STATUS: needs-input` with the round's message id. The Manager brings the answers back; "ok" means "accept all recommendations".
6. **Recompute the frontier** with the new answers and repeat. Done when the frontier is empty: every branch visited, nothing silently assumed.

## Rules

- No shortcuts: never skip a question because you think the person would accept your recommendation anyway. If it has no Evidence, it is theirs — even if you're confident.
- Evidence must be specific (a file path, a URL, a quoted decision). "Best practice" alone is not Evidence for a choice of taste.
- Keep rounds small enough to answer from a phone (≤ 7 open questions per round).
- Record answers that are durable knowledge in the KB (team protocol §3).
