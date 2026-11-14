# Running the site

Everything runs on GitHub: Actions builds the data, and Pages hosts the site. There are no servers,
secrets or API keys to look after. The workflow uses only the built-in `GITHUB_TOKEN`.

**One-time repository setting:** *Settings → Pages → Build and deployment → Source: GitHub Actions*.
This is already set.

## Workflows

### Update forecast and deploy (`update.yml`)

The only workflow that publishes the site.

| Trigger | What happens |
| --- | --- |
| **Schedule**, cron `47 * * * *` | `pipeline.build` checks for new runs; it fetches and deploys only if there is something new (see [pipeline.md](pipeline.md#when-the-apis-are-called)) |
| **Push to `main`** touching `site/`, `pipeline/`, `tests/` or the workflow | run the offline tests, then republish with the **live data** (`--reuse-only`, no API calls) |
| **Manual**, "Run workflow" | options below |

GitHub runs scheduled workflows on a best-effort basis. The cron says hourly, but in practice it
fires about 3–5 times a day at irregular times. That is enough, because the sources publish only a
few runs a day. The hourly cron just means a missed slot costs an hour, not six.

Manual run options (*Actions → Update forecast and deploy → Run workflow*):

| Option | Use when |
| --- | --- |
| *(neither)* | same as a scheduled run: fetch if something is new |
| **force** | you want fresh data now, e.g. after adding a spot or changing how data is processed. Fetches every source once. |
| **republish** | you want to redeploy the current code with the live data and no API calls. Same as a push. |

Steps:
1. Install → Test (push only).
2. Build: writes `site/data`, and sets `changed`.
3. Version the scripts: replaces `?v=dev` in `index.html` with the commit SHA, so browsers load the
   new `beach.js`, `swell.js` and `probe.js`.
4. Summary: `report.json` in the run summary.
5. Deploy to Pages, only if `changed` is true. A failed deploy is retried once after 90 s.
6. Keep alive: GitHub disables scheduled workflows after 60 days without a commit, so after 45 quiet
   days the workflow pushes an empty commit.

The workflow uses `concurrency: pages`, so two runs never deploy at the same time; the second one
waits.

### Debug sources (`debug-sources.yml`), manual

- Checks each source with one tiny request: the AEMET archive headers, the newest Puertos files and
  their subset service, and one point each from Open-Meteo's forecast and marine APIs.
- Prints the live `report.json`.
- Copies the live data files to the **`snapshot`** branch (overwritten every time). This is how to
  get the live data onto a machine that can reach GitHub but not github.io.
- Publishes nothing.

### Cancel a stuck Pages deployment (`unstick-pages.yml`), manual

For the error *"…due to in progress deployment. Please cancel `<id>` first"*. Run it with that id,
then re-run the failed workflow (choose **republish** to avoid API calls).

## Everyday tasks

**Is the data fresh?**
- The site's top bar says "Updated …".
- The Sources panel shows each source's time.
- In more detail, open https://jakobwalt.github.io/sal-y-viento/data/report.json or the latest run's
  summary in Actions.

**Most runs say "nothing to deploy".** That is normal: no source had a new run. The log line is
`no new runs since the last build (…); nothing fetched, nothing to deploy`.

**Ship a code change.** Push to `main`. The tests run, the live data is reused, and the site
redeploys in about a minute. Check the build log for `reused the live data; no source was queried`
and `Reported success!`.

**Refresh the data now.** Run the workflow with **force**.

**After changing how data is processed** (anything in `pipeline/` that changes values): push, then
run once with **force**. A push alone reuses the old data files. The one exception is a moved
`wave_point`, which takes effect on a push.

## Troubleshooting

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| A source shows an old time in the Sources panel | that source failed in recent builds; the site keeps its previous data | `report.json` → `errors`; run **Debug sources** |
| `AEMET colours no longer match the legend` | AEMET changed its colour scale | update `LEGENDS` in `pipeline/aemet.py` (the decoded legends come from roman-HG's repository, linked in the README) |
| `No wave forecast file found` | Puertos changed its catalogue, or nothing published this month yet (the previous month is tried too) | **Debug sources** shows what is in the catalogue |
| Open-Meteo HTTP 429 | rate limit | check that nothing calls more often than the schedule; it recovers by itself |
| Deploy fails: "in progress deployment" | a Pages deployment hung | **Cancel a stuck Pages deployment** |
| Deploy fails otherwise | GitHub Pages hiccup | re-run with **republish** |
| No scheduled runs for days | GitHub disabled the schedule (60 days without activity) or an Actions outage | push any commit or run manually; the keep-alive step should prevent this |
| Push fails the **Test** step | a test broke | run `python -m pytest tests -q` locally (see [development.md](development.md)) |
| Site shows "Forecast unavailable" | a data file is missing or has the wrong size | open `data/meta.json` in the browser; re-run with **force** |
| Visitors see old behaviour after a deploy | browser cache of `index.html` | reload; the scripts are versioned, the page itself is cached briefly by Pages |

## Rolling back

- **Code:** revert the commit and push. The live data is reused, so this costs no API calls.
- **Data:** builds always start from the live data. To throw it away, run with **force**, which
  fetches fresh runs. Hours of today before the newest runs then come from the earlier live data,
  if it is from the same day.
