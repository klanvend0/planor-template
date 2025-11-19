---
description: How to deploy the Planor App Template and CLI
---

# Deployment Guide

This guide explains how to deploy your template and CLI tool.

## 1. The Template (GitHub)

The template is the code that users will download. It lives on GitHub.

1.  **Do NOT add `cli` to `.gitignore` yet.**
    - **Reason**: If you want to keep everything in one repo (monorepo style), you commit the `cli` folder.
    - **However**, when users download the template, they don't need the `cli` folder inside their new app.
    - **Solution**: Our CLI code already handles this! In `cli/src/index.ts`, we have a step: `fs.rmSync(cliDir, ...)` which removes the `cli` folder after downloading.
    - **So**: Commit the `cli` folder to your repo so you can maintain it.

2.  **Push to GitHub**:
    - Create a repo (e.g., `planor-template`).
    - `git add .`
    - `git commit -m "Initial commit"`
    - `git push origin main`

## 2. The CLI Tool (NPM)

The CLI tool is what users run (`npx create-planor-app`). It lives on NPM.

1.  **Prepare for NPM**:
    - Go to the CLI directory: `cd cli`
    - Update `package.json` name if needed (must be unique on NPM).
    - Update `src/index.ts` to point to your **actual GitHub repo** (replace `selim/planor-template` with `your-username/planor-template`).

2.  **Publish to NPM**:
    - `npm login` (if not logged in).
    - `npm publish --access public`

## Summary of User Experience

1.  User runs `npx create-planor-app my-app`.
2.  NPM downloads your CLI tool.
3.  CLI tool runs, asks for project name.
4.  CLI tool uses `degit` to download `your-username/planor-template` from GitHub.
5.  CLI tool deletes the `cli` folder from the downloaded project.
6.  User has a fresh app!
