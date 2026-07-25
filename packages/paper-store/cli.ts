#!/usr/bin/env tsx
/**
 * PaperWithA paper-store CLI.
 *
 * Usage:
 *   tsx packages/paper-store/cli.ts list
 *   tsx packages/paper-store/cli.ts ingest ~/Downloads/paper.pdf
 *   tsx packages/paper-store/cli.ts result <hash>
 *   tsx packages/paper-store/cli.ts path
 */
import { loadIndex, ingestPaper, loadPaperResult, computeFileHash, paperwithaPaths } from "./src/index.js";

const cmd = process.argv[2];
const arg = process.argv[3];

async function main() {
  switch (cmd) {
    case "path": {
      const paths = paperwithaPaths();
      console.log(paths.papersDir);
      break;
    }
    case "list": {
      const index = await loadIndex();
      if (index.papers.length === 0) {
        console.log("(no papers indexed)");
      } else {
        for (const p of index.papers) {
          console.log(`${p.status}  ${p.fileHash.slice(0, 12)}  ${p.title}  (${p.fileName})`);
        }
      }
      break;
    }
    case "ingest": {
      if (!arg) { console.error("usage: cli.ts ingest <path-to-pdf>"); process.exit(1); }
      const entry = await ingestPaper(arg);
      console.log(JSON.stringify(entry, null, 2));
      break;
    }
    case "result": {
      if (!arg) { console.error("usage: cli.ts result <hash>"); process.exit(1); }
      const result = await loadPaperResult(arg);
      if (!result) console.log("(no result yet)");
      else console.log(JSON.stringify(result, null, 2));
      break;
    }
    default:
      console.log("PaperWithA paper-store");
      console.log("  path               print papers directory");
      console.log("  list               list indexed papers");
      console.log("  ingest <file>      add a paper PDF");
      console.log("  result <hash>      show analysis result");
      const paths = paperwithaPaths();
      console.log(`\nPapers:  ${paths.papersDir}`);
      console.log(`Results: ${paths.resultsDir}`);
      console.log(`Index:   ${paths.indexPath}`);
  }
}

main().catch(console.error);
