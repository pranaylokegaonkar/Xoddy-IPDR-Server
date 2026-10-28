# Replit → GitHub → Ubuntu update

## Publish source changes from Replit

Review and commit the intended changes in Replit's **Git** pane, then use **Push**.
Alternatively, after committing and confirming the working tree is clean, run:

```bash
bash deploy/push-xoddy-ipdr.sh
```

This only pushes committed changes on `main`; it does not create commits or force-push.

Use pnpm 10.26.0 or later. Build approvals use `allowBuilds`, supported by
pnpm 10.26+ and newer major versions. The old `onlyBuiltDependencies` setting
is not supported by pnpm 11+. With that old setting, a new pnpm installation
can append approval placeholders to the workspace file, making the checkout
dirty and blocking the next update. Do not repeatedly stash these generated
placeholders or bypass the clean-checkout guard; use the committed policy.

## Include the updater during a new Ubuntu installation

After cloning the repository to `/opt/xoddy-ipdr` and configuring the root
account's read-only SSH deploy key for the GitHub repository, install the
command as part of the Ubuntu server setup:

```bash
sudo bash /opt/xoddy-ipdr/deploy/install-xoddy-ipdr-update.sh
```

That installs `/usr/local/sbin/xoddy-ipdr-update`. Each later release is:

```bash
sudo xoddy-ipdr-update
```

The command fetches and fast-forwards `main`, installs dependencies, typechecks
and builds the libraries/API/web app, applies database schema changes, restarts
the `xoddy-ipdr` systemd service, and validates/reloads Nginx. It refuses to
update when the server checkout contains local changes or Git cannot fetch.
Database schema changes are applied by `drizzle-kit push`; review the schema
change and maintain a database backup as part of production release practice.
Dependency-install failures, including unapproved build scripts, stop the
update. Only the explicitly listed packages may run dependency build scripts.

The updater uses the systemd service's `EnvironmentFile`, so updates connect to
the same database as the running application. If no service environment is
configured, it uses `/opt/xoddy-ipdr/.env`, falling back to
`/etc/xoddy-ipdr/xoddy-ipdr.env`. Multiple service environment files require an
explicit override. To select a file explicitly:

```bash
sudo env ENV_FILE=/opt/xoddy-ipdr/.env xoddy-ipdr-update
```

A bounded, read-only database connection check runs before building or pushing
the schema. It reports error codes without printing the connection URL or
password. A missing database is an error, never a reason to create a new empty
database automatically.

Remove any revoked GitHub token from local environment files; Git fetch
authentication is taken from the configured Git remote instead.
