# The test deployment

**Read this when** you deploy, update, reset or fill the test deployment, or give someone its address.
**Related:** [architecture.md § Environments and hosting](./architecture.md#environments-and-hosting), [D20](./decisions.md).

---

## What it is

COAL running online, the same way it runs locally, so a few people can try it and give feedback ([D20](./decisions.md)). It is **not** production:

- **made-up data only**, as in local work;
- sign-in is by name, so anyone with the address can sign up;
- uploads aren't scanned for viruses, and show "not scanned";
- the address is one Railway gives, not COAL's own domain (I6). Passkeys registered here will be registered again later.

It runs on [Railway](https://railway.com), in the project `coal-demo`, in Singapore (the closest region to India). The commands below use the Railway CLI: install it (`brew install railway`), then run `railway login` and `railway link` (choose `coal-demo`) once in the repository folder.

**The address isn't written in the repository** because the repository is public. Find it in Railway under `web` → Settings → Networking, or with `railway domain list --service web`. Share it only with the people testing.

## The pieces

They are the same as in local work ([architecture.md](./architecture.md#environments-and-hosting)).

| Railway service | What it is | Built from |
|---|---|---|
| `Postgres` | PostgreSQL 18, with its volume | Railway's PostgreSQL template |
| `coal-files` | File storage: a Railway bucket (S3-compatible). It stands in for MinIO | Railway |
| `gotenberg` | Turns Word files into PDFs. Private | `gotenberg/gotenberg:8` |
| `backend` | The API and the worker in one process, as `pnpm dev` runs them: it migrates the database on every start, then loads the sample templates and the made-up holidays. Private | [backend/Dockerfile](../backend/Dockerfile) |
| `web` | The website, with the only public address. It forwards `/api/v1` to the backend over Railway's private network | [web/Dockerfile](../web/Dockerfile) |

## Settings

Set in Railway (`railway variable list --service …`), never in the repository. Anything not listed keeps its default from `backend/src/core/config.ts`.

| Service | Setting | Value |
|---|---|---|
| `backend` | `RAILWAY_DOCKERFILE_PATH` | `backend/Dockerfile` |
| | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | `${{coal-files.ENDPOINT}}` and the bucket's other values |
| | `S3_FORCE_PATH_STYLE`, `S3_CREATE_BUCKET` | `false`, `false` |
| | `GOTENBERG_URL` | `http://${{gotenberg.RAILWAY_PRIVATE_DOMAIN}}:3000` |
| | `COOKIE_SECURE` | `true` |
| | `AI_PROVIDER`, `ANTHROPIC_API_KEY`, `ANTHROPIC_WORKSPACE_ID` | `anthropic`, and the key and workspace from Madhav. Never the Copilot stand-in ([D19](./decisions.md)) |
| | `NCBI_API_KEY`, `OPENFDA_API_KEY`, `RESEARCH_CONTACT_EMAIL` | Optional. Free keys and a contact address that raise the public sources' limits for research ([workstation-and-ai.md](./workstation-and-ai.md#researching-what-already-exists)). Research works without them, and the default sources load when the backend migrates. Websites in the source library are searched only on `anthropic` |
| `web` | `RAILWAY_DOCKERFILE_PATH` | `web/Dockerfile` |
| | `COAL_API_URL` | `http://backend.railway.internal:4000`. Read when the website is **built**, so a change needs a rebuild |
| | `PORT` | `3000`, the port of the public address |

`NODE_ENV` isn't set, so the backend runs as it does locally. In production mode it would refuse to start without a virus scanner.

The browser uploads to the bucket and reads PDFs from it through short-lived links, so the bucket has a CORS rule that lets the website's address use `GET`, `PUT` and `HEAD`. If the website's address changes, set the rule again. From `backend/`:

```sh
railway run --service backend -- node --input-type=module -e '
import { S3Client, PutBucketCorsCommand } from "@aws-sdk/client-s3";
const e = process.env;
await new S3Client({ endpoint: e.S3_ENDPOINT, region: e.S3_REGION,
  credentials: { accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY } })
  .send(new PutBucketCorsCommand({ Bucket: e.S3_BUCKET, CORSConfiguration: { CORSRules: [{
    AllowedOrigins: ["https://<the website address>"], AllowedMethods: ["GET", "PUT", "HEAD"],
    AllowedHeaders: ["*"], MaxAgeSeconds: 3000 }] } }));'
```

## Updating it

**Push to `main`.** When CI passes, Railway rebuilds `backend` and `web` ("Wait for CI" is on), and the backend migrates the database as it starts. To roll back, redeploy an earlier deployment in Railway.

- **Route files.** A loaded route version is never changed ([architecture.md](./architecture.md#the-process-engine)). If a loaded route file is edited in place, the backend refuses to start. Add a new version file, or [start again](#starting-again).
- **Logs:** `railway logs --service backend` (add `--build` for the build).

## Filling it with made-up data

`railway ssh` needs your SSH key registered once: `railway ssh keys add` (add `--key` and the path if you have several keys, and `-i` with the same key to `railway ssh`).

Once, on an empty database, after the backend has started:

```sh
railway ssh --service backend -- pnpm seed:demo
```

It makes 14 made-up people and three projects, some of them late. Sign in as, for example, *Vera Demo* (the VP) or *Hari Demo* (the R&D Head). People can also sign up with their own name and a role.

## Starting again

To empty the database and fill it again:

1. Make a new, empty database:

   ```sh
   railway ssh --service Postgres -- psql -U postgres -d postgres \
     -c "DROP DATABASE railway WITH (FORCE)" -c "CREATE DATABASE railway"
   ```

2. Restart the backend so it migrates the empty database: `railway redeploy --service backend --yes`.
3. Fill it again, as [above](#filling-it-with-made-up-data).

Files already in the bucket stay there, unused. That's harmless with made-up data.

## Things to know

- **Cost.** Railway's trial credit covers the first weeks. After that, the Hobby plan costs US$5 a month, including US$5 of usage. Check with `railway usage`.
- **AI spending.** Each person may spend US$5 a day ([D18](./decisions.md)), and every new account gets its own allowance. If the address spreads, turn the AI off with `AI_PROVIDER=none` on `backend`.
- **Rate limits.** Railway's proxy isn't named in `TRUST_PROXY`, so everyone shares one sign-in counter (20 a minute) and one AI counter ([architecture.md § Security basics](./architecture.md#security-basics)). That's enough for a few people.
- **Company networks that inspect traffic** (such as Netskope on a work laptop) can hold a streamed response until it ends. There, the bell doesn't update live and AI replies appear all at once. Everything else works, and other networks are unaffected. To check, look at who issued the site's certificate: it should be Let's Encrypt.
