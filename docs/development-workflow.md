# Guardian Development Workflow

## Branch Flow

1. Always start from the remote `develop` branch.
2. Create a local feature branch for each change, using a clear name such as `codex/<feature-name>`.
3. Implement and verify changes locally on the feature branch.
4. Commit the feature branch with a focused message.
5. Push the feature branch to GitHub.
6. Merge the feature branch into `develop` after validation.
7. Merge `develop` into `main` for deployment.
8. Tencent Cloud deploys from `main` only.

## Repository Rule

The active Guardian development repository is:

`F:\Guardian\Guardian`

Remote:

`https://github.com/tangxiaoka-pixel/Guardian.git`

## Scope Rule

Platform console is for platform governance, customers, authorization, audit, and global operations.

Forge training center modules belong to the project console, including materials, VLM audit, human review, datasets, training release, model registry, and cold-start scenario templates.
