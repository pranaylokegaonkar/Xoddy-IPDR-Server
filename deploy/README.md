# Replit → GitHub → Ubuntu update

## Publish source changes from Replit

Review and commit the intended changes in Replit's **Git** pane, then use **Push**.
Alternatively, after committing and confirming the working tree is clean, run:

```bash
bash deploy/push-xoddy-ipdr.sh
```

This only pushes committed changes on `main`; it does not create commits or force-push.

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

The application environment, including `DATABASE_URL`, is loaded from
`/etc/xoddy-ipdr/xoddy-ipdr.env`. Remove any revoked GitHub token from that file;
Git fetch authentication is taken from the configured Git remote instead.
