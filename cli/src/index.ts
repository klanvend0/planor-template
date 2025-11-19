import { Command } from 'commander';
import prompts from 'prompts';
import degit from 'degit';
import chalk from 'chalk';
import ora from 'ora';
import execa from 'execa';
import path from 'path';
import fs from 'fs';

const program = new Command();

program
  .name('create-planor-app')
  .description('CLI to create a new Planor App')
  .argument('[project-name]', 'Name of the project')
  .action(async (projectName) => {
    let name = projectName;

    if (!name) {
      const response = await prompts({
        type: 'text',
        name: 'projectName',
        message: 'What is your project name?',
        initial: 'my-planor-app',
      });
      name = response.projectName;
    }

    if (!name) {
      console.log(chalk.red('Project name is required!'));
      process.exit(1);
    }

    const targetDir = path.resolve(process.cwd(), name);

    if (fs.existsSync(targetDir)) {
      console.log(chalk.red(`Directory ${name} already exists!`));
      process.exit(1);
    }

    console.log(chalk.blue(`\nCreating a new Planor App in ${targetDir}...\n`));

    const spinner = ora('Downloading template...').start();

    try {
      // Clone the current repository.
      // TODO: Replace 'your-username/planor-template' with the actual repo URL when published.
      // For now, we assume the user will update this or we use a placeholder.
      // Since I don't know the remote URL, I'll use a placeholder that the user needs to update.
      // However, for local testing, degit works with local paths if prefixed with 'git@' or similar but usually for remote.
      // I will use the current directory as source if we are running locally for test,
      // but for a real CLI it needs a repo.
      // I'll use a placeholder 'selim/planor-template' based on the path, but user might need to change it.
      // Actually, let's ask the user to verify the repo URL in the plan.
      // For now I will put a placeholder.
      const emitter = degit('selim/planor-template', {
        cache: false,
        force: true,
        verbose: true,
      });

      await emitter.clone(targetDir);
      spinner.succeed('Template downloaded!');

      // Remove the cli folder from the generated project
      const cliDir = path.join(targetDir, 'cli');
      if (fs.existsSync(cliDir)) {
        fs.rmSync(cliDir, { recursive: true, force: true });
      }

      console.log(chalk.green('\nInstalling dependencies...'));
      await execa('npm', ['install'], { cwd: targetDir, stdio: 'inherit' });

      console.log(chalk.green('\nSuccess! Created ' + name + ' at ' + targetDir));
      console.log('Inside that directory, you can run several commands:\n');
      console.log(chalk.cyan('  npm run dev'));
      console.log('    Starts the development server.\n');
      console.log(chalk.cyan('  npm run android'));
      console.log('    Starts the app on Android.\n');
      console.log(chalk.cyan('  npm run ios'));
      console.log('    Starts the app on iOS.\n');
      console.log('\nWe suggest that you begin by typing:\n');
      console.log(chalk.cyan('  cd'), name);
      console.log(chalk.cyan('  npm run dev'));
    } catch (error) {
      spinner.fail('Failed to create project');
      console.error(chalk.red(error));
      process.exit(1);
    }
  });

program.parse(process.argv);
