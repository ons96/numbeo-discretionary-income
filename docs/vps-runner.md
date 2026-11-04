# Running the crawl from your VPS

numbeo.com answers datacenter IP ranges with `503 Access Forbidden`, which is why
the *Crawl* workflow cannot run on GitHub's hosted runners. Your VPS is not on
such a range, so it makes a perfect runner: GitHub still schedules the job, the
VPS does the two requests, the data is committed, and Pages rebuilds itself.

Everything below runs on the VPS (Debian/Ubuntu assumed, root or a user with sudo).

## 1. Install the runner

```bash
mkdir -p ~/actions-runner && cd ~/actions-runner
curl -O -L https://github.com/actions/runner/releases/download/v2.338.2/actions-runner-linux-x64-2.338.2.tar.gz
tar xzf actions-runner-linux-x64-2.338.2.tar.gz

# token from: gh api -X POST repos/ons96/numbeo-discretionary-income/actions/runners/registration-token -q .token
# (valid for one hour, single use)
./config.sh \
  --url https://github.com/ons96/numbeo-discretionary-income \
  --token <REGISTRATION_TOKEN> \
  --name numbeo-vps \
  --labels numbeo \
  --unattended

sudo ./svc.sh install "$USER"
sudo ./svc.sh start
sudo ./svc.sh status
```

## 2. Point the workflow at it

In the repo: Settings → Secrets and variables → Actions → Variables → New:

| name | value |
| --- | --- |
| `CRAWL_RUNNER` | `numbeo` |

That makes `crawl.yml` pick this machine up (`runs-on: ${{ vars.CRAWL_RUNNER }}`)
and turns on the daily 05:37 UTC run.

## 3. Try it

Actions → *Crawl* → Run workflow, `page_budget` = 0. Two requests, a few seconds,
one commit, and the *Publish* workflow deploys the new data.

## Notes

* **Security.** A self-hosted runner executes whatever the workflows in this repo
  say. That is fine because the only triggers are `workflow_dispatch` and `push`
  — no `pull_request` — so a stranger cannot run code on your box. Do not add a
  `pull_request` trigger to this repo while the runner is attached.
* **Cost.** Self-hosted runners do not use the account's Actions minutes.
* **Living costs.** `page_budget` > 0 additionally fetches city pages to replace
  the estimated living costs with numbeo's own figures. 200 per night is polite
  and finishes ~570 cities in three nights.
* **Stopping it.** `sudo ./svc.sh stop`, or remove the `CRAWL_RUNNER` variable.
