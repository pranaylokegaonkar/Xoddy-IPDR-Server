# Replit → GitHub → Ubuntu update

## Publish source changes from Replit

Review and commit the intended changes in Replit's **Git** pane, then use **Push**.
Alternatively, after committing and confirming the working tree is clean, run:

```bash
bash deploy/push-xoddy-ipdr.sh
```

This only pushes committed changes on `main`; it does not create commits or force-push.

## Install the Ubuntu update command

The Ubuntu server must already have `/opt/xoddy-ipdr` cloned from the GitHub
repository. Configure its `origin` remote to authenticate without putting a
GitHub token in the URL or script. A read-only SSH deploy key is recommended.
The key must be available to root because the command is run with `sudo`.

Configure the SSH deploy key for the root account (the updater runs through
`sudo`) and make sure the checkout's `origin` uses that SSH remote. Then pull
the new script onto the server once:

```bash
sudo git -C /opt/xoddy-ipdr pull --ff-only origin main
```

Install the command:

```bash
sudo install -o root -g root -m 0755 \
  /opt/xoddy-ipdr/deploy/xoddy-ipdr-update.sh \
  /usr/local/sbin/xoddy-ipdr-update
```

Then each update is:

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
