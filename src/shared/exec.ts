import { type ExecFileOptions, execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface RunCommandOptions {
  readonly cwd?: string | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly timeoutMs?: number | undefined;
}

/**
 * Execute a command binary and return stdout, stderr, and exit code.
 * Does not throw on non-zero exit codes.
 */
export async function runCommand(
  file: string,
  args: readonly string[] = [],
  options: RunCommandOptions = {}
): Promise<CommandResult> {
  const execOptions: ExecFileOptions = {
    cwd: options.cwd,
    env: options.env ?? process.env,
    timeout: options.timeoutMs,
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  };

  try {
    const { stdout, stderr } = await execFileAsync(file, args as string[], execOptions);
    return {
      exitCode: 0,
      stdout: typeof stdout === "string" ? stdout : stdout.toString("utf8"),
      stderr: typeof stderr === "string" ? stderr : stderr.toString("utf8"),
    };
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
      // System error like ENOENT (binary not found)
      if (error.code === "ENOENT") {
        return {
          exitCode: 127,
          stdout: "",
          stderr: `Executable not found: ${file}`,
        };
      }
    }

    const execErr = error as {
      code?: number | string;
      stdout?: string | Buffer;
      stderr?: string | Buffer;
    };
    const exitCode = typeof execErr.code === "number" ? execErr.code : 1;
    const stdout =
      typeof execErr.stdout === "string"
        ? execErr.stdout
        : (execErr.stdout?.toString("utf8") ?? "");
    const stderr =
      typeof execErr.stderr === "string"
        ? execErr.stderr
        : (execErr.stderr?.toString("utf8") ?? "");

    return {
      exitCode,
      stdout,
      stderr,
    };
  }
}
