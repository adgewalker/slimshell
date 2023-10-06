import chalk from "chalk";
import minimist from "minimist";
import readline from "readline";

export interface IArgumentDefinition {
  description: string;
  name: string;
  alternatives?: Array<string>;
}

export interface IArguments
  extends Record<
    string,
    string | number | boolean | Array<string | number | boolean>
  > {}

export interface ICommandResponse {
  success: boolean;
  messages?: Array<string>;
}

export interface ICommandDefinition {
  verb: string;
  noun?: string;
  command: Command;
  requiredArguments?: Array<IArgumentDefinition>;
}

export type Command = (args?: IArguments) => Promise<ICommandResponse>;

const NoCommand = async (): Promise<ICommandResponse> => {
  return { success: true };
};

export interface IOnable {
  on: (verb: string) => IWithable;
}

export interface ICallable {
  call: (command: Command) => IRequirable;
}

export interface IWithable extends ICallable {
  with: (noun: string) => ICallable;
}

export interface IRunable {
  run: () => Promise<boolean>;
}

export interface IRequirable extends IRunable {
  requiring: (argDefinitions: Array<IArgumentDefinition>) => IRunable;
}

export interface ISlimshellConfig {
  title?: string;
  version?: string;
  exitCommands?: Array<string>;
}

const DEFAULT_CONFIG = {
  title: "Slimshell",
  version: "1.0.0",
  exitCommands: ["exit"],
};

const exit = async (): Promise<ICommandResponse> => {
  return { success: false, messages: ["byeee"] };
};

export default class Slimshell implements IOnable {
  protected config: ISlimshellConfig;
  protected cds: Record<string, Array<ICommandDefinition>>;
  private input: readline.Interface;

  constructor(config: ISlimshellConfig) {
    this.config = {
      title: config.title || DEFAULT_CONFIG.title,
      version: config.version || DEFAULT_CONFIG.version,
      exitCommands: [...config.exitCommands, ...DEFAULT_CONFIG.exitCommands]
    }
    this.cds = {};
    for (const ec of this.config.exitCommands) {
      this.cds[ec] = [{ verb: ec, command: exit }];
    }
    this.initInput();
  }

  private initInput(): void {
    if (this.input) {
      this.input.close();
    }
    this.input = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    readline.emitKeypressEvents(process.stdin);
  }

  private normaliseCommand(command: string) {
    return command.trim();
  }

  private async getCommand(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.input.question("> ", (command: string) => {
        resolve(command);
      });
    });
  }

  private async getArgument(req: IArgumentDefinition): Promise<string> {
    return new Promise((resolve, reject) => {
      if (process.stdin.isTTY) process.stdin.setRawMode(true);

      process.stdin.on("keypress", (chunk, key) => {
        if (key && key.name == "escape") {
          reject();
        }
      });

      this.input.question(chalk.yellow(`  $${req.description}: `), (value: string) => {
        resolve(value.trim());
      });
    });
  }

  private async runCommand(command: string): Promise<boolean> {
    const atoms = command.split(" ");
    const args = minimist(atoms.slice(1));
    const verb = atoms[0];
    const noun = args["_"].length > 0 ? args["_"][0] : undefined;

    // attempt to match the command based on the verb and noun
    const cd = this.cds[verb]?.find(
      (def: ICommandDefinition) => def.noun === noun
    );

    if (!cd) {
      console.log(chalk.cyan('  wut?'))
      return true;
    }

    if (cd.requiredArguments) {
      // validate the input parameters, and ask for any that are missing
      for (const req of cd.requiredArguments) {
        if (!args[req.name]) {
          args[req.name] = req.alternatives.find(
            (alt: string) => args[alt] !== undefined
          );
          while (!args[req.name]) {
            // get the argument from user input
            try {
              args[req.name] = await this.getArgument(req);
            } catch (e) {
              // escape key most likely
              this.initInput();
              console.log("Cancelled");
              return true;
            }
          }
        }
      }
    }
    const response = await cd.command(args);
    if (response.messages) {
      for (const msg of response.messages) {
        console.log(chalk.cyan(`  ${msg}`));
      }
    }
    return response.success;

  }

  public on(verb: string): IWithable {
    if (!this.cds[verb]) {
      this.cds[verb] = [];
    }

    const cd: ICommandDefinition = { verb, command: NoCommand };
    this.cds[verb].push(cd);
    return new _ssWith(this, cd);
  }

  public async run(): Promise<boolean> {
    let running = true;

    while (running) {
      // attempt to match the command based on the input
      const command = await this.getCommand();
      // now run the command
      running = await this.runCommand(this.normaliseCommand(command));
    }

    return true;
  }
}

class _ssBase {
  protected shell: Slimshell;
  protected cd: ICommandDefinition;

  constructor(shell: Slimshell, cd: ICommandDefinition) {
    this.shell = shell;
    this.cd = cd;
  }
}

class _ssCall extends _ssBase implements ICallable {
  public call(command: Command): IRequirable {
    this.cd.command = command;
    return new _ssRequiring(this.shell, this.cd);
  }
}

class _ssWith extends _ssCall implements IWithable, ICallable {
  public with(noun: string): ICallable {
    this.cd.noun = noun;
    return new _ssCall(this.shell, this.cd);
  }
}

class _ssRun extends _ssBase implements IRunable {
  public async run(): Promise<boolean> {
    return this.shell.run();
  }
}

class _ssRequiring extends _ssRun implements IRequirable {
  public requiring(requiredArguments: Array<IArgumentDefinition>): IRunable {
    this.cd.requiredArguments = requiredArguments;
    return new _ssRun(this.shell, this.cd);
  }
}
