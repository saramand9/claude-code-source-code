# CLI Verification Example

For CLI changes, verify the smallest real command path that exercises the
change, then run the relevant regression test.

```text
npm run check
npm run build
node dist\cli.js --help
```

Record the command output or the failure message in the final summary.
