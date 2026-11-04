# Running the crawl from your VPS

**Optional.** The daily crawl already runs on GitHub's own runners: when numbeo
refuses the datacenter IP, `scraper/lib/http.mjs` fetches the two pages through
r.jina.ai instead. Use a self-hosted runner only if you would rather the
requests came from your own connection (no third party in the path, and the
optional per-city pass can run at full speed).

With a runner here, GitHub schedules the job, the machine does the requests, the
data is committed, and Publish rebuilds the site.

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

## 2. Point the workflow at it (optional)

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
