// Every screenplay, performed at full speed with no recording. Run it from
// the Omakase checkout, through its check runner:
//   npm run check -- ../omakase-demo-factory/checks/screenplays.mjs
// Pass screenplay names after `--` to run only those.
process.argv.splice(2, 0, "check");
await import("../bin/demo.mjs");
