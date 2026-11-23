// Which failed Chrome starts the browser checks count as a refused GPU start (tests/support/chrome-test-launch.mjs):
// the exit codes, and the startup log a parent exit of 0x80000003 needs beside it.
// 0xC0000022 as Node reports it on Windows, unsigned, and as PowerShell shows it, signed.
export const GPU_START_REFUSED_EXIT_CODES = Object.freeze([3221225506, -1073741790]);
// 0x80000003, the browser ending itself, unsigned and signed: a refused GPU start only with the startup log's evidence.
export const GPU_FATAL_PARENT_EXIT_CODES = Object.freeze([2147483651, -2147483645]);
// How much of the browser's standard error a failed start keeps, for that judgement and for its report: the end.
export const STARTUP_LOG_CHARACTERS = 16000;
const GPU_PROCESS_REFUSED = /GPU process[^\r\n]*(?:-1073741790|3221225506)/u;
const GPU_NOT_USABLE = /GPU process isn't usable/u;

export const boundedStartupLog = (text) => String(text ?? "").slice(-STARTUP_LOG_CHARACTERS);

// Whether a start that failed with `exitCode`, its browser's startup log being `startupLog`, was a refused GPU start.
export function isGpuStartRefused(exitCode, startupLog = "") {
  if (GPU_START_REFUSED_EXIT_CODES.includes(exitCode)) return true;
  return GPU_FATAL_PARENT_EXIT_CODES.includes(exitCode) && GPU_PROCESS_REFUSED.test(startupLog) && GPU_NOT_USABLE.test(startupLog);
}
