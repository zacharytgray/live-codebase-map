#!/usr/bin/env node
// thin shim -> compiled cli. keeps the hook command path stable.
import { main } from "../dist/cli.js";

main(process.argv.slice(2)).catch((err) => {
  console.error(err);
  process.exit(1);
});
