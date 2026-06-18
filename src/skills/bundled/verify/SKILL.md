---
description: Verify that a completed implementation matches the accepted plan by running focused checks and reporting evidence.
---

# Verify

Use this skill after implementation work is finished and before reporting completion.

1. Re-read the accepted plan or user request.
2. Identify the behavior that must be true for the change to count as complete.
3. Run targeted checks for the changed code paths.
4. Report exact commands, results, and any remaining risk.

If `VerifyPlanExecution` is available, call it after implementation is complete.
In this source build that tool records the verification request but does not run
Anthropic's internal verifier, so manual test evidence is still required.
