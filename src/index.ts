import { readFileSync } from "node:fs";
import { runLocalLoop, writeLocalLoopRun } from "./local-loop.ts";

type CliOptions = {
  transcript?: string;
  file?: string;
  outDir: string;
  callerName?: string;
  callerPhone?: string;
};

const DEFAULT_TRANSCRIPT =
  "Create an MVP for AgentLine: parse a phone transcript, create a task packet, route it to a stub agent, and decide whether to call back.";

function main() {
  const options = parseArgs(process.argv.slice(2));
  const transcript = readTranscript(options);
  const run = runLocalLoop({
    transcript,
    caller: {
      displayName: options.callerName,
      phoneNumber: options.callerPhone,
    },
  });
  const outputPath = writeLocalLoopRun(run, options.outDir);

  console.log(
    JSON.stringify(
      {
        runId: run.runId,
        taskId: run.task.id,
        intent: run.task.intent,
        execution: run.execution.status,
        callback: run.callback,
        outputPath,
      },
      null,
      2,
    ),
  );
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    outDir: ".agentline/runs",
  };
  const transcriptParts: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === "--file") {
      options.file = requireValue(arg, next);
      index += 1;
      continue;
    }

    if (arg === "--transcript") {
      options.transcript = requireValue(arg, next);
      index += 1;
      continue;
    }

    if (arg === "--out") {
      options.outDir = requireValue(arg, next);
      index += 1;
      continue;
    }

    if (arg === "--caller-name") {
      options.callerName = requireValue(arg, next);
      index += 1;
      continue;
    }

    if (arg === "--caller-phone") {
      options.callerPhone = requireValue(arg, next);
      index += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    transcriptParts.push(arg);
  }

  if (transcriptParts.length > 0 && !options.transcript) {
    options.transcript = transcriptParts.join(" ");
  }

  return options;
}

function readTranscript(options: CliOptions): string {
  if (options.file) {
    return readFileSync(options.file, "utf8");
  }

  return options.transcript ?? DEFAULT_TRANSCRIPT;
}

function requireValue(flag: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }

  return value;
}

function printHelp() {
  console.log(`AgentLine local loop

Usage:
  npm run mvp
  npm run start -- --file examples/transcripts/project-seed.txt
  npm run start -- --transcript "Create a Codex adapter and call me back if anything is missing."

Options:
  --file <path>           Read transcript from a text file
  --transcript <text>     Use inline transcript text
  --out <dir>             Write inspectable JSON run output to a directory
  --caller-name <name>    Set caller display name
  --caller-phone <phone>  Set caller phone number
`);
}

main();

