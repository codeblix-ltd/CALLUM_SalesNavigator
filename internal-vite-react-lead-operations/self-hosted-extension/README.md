# Callum Scout self-hosting

This directory is the static hosting bundle for:

`https://extensions.codeblix.com/`

It provides a temporary Windows installation path while the unlisted Chrome
Web Store release is under review. It does not replace the Web Store release.

## Hosting needed

Create the `extensions.codeblix.com` subdomain with HTTPS and serve this
directory as the subdomain's document root. A normal cPanel/Apache document
root, Cloudflare Pages project, or equivalent static host is enough. No Node
process, database, or server-side application is required.

Upload these files:

- `index.html`
- `Install-CallumScout.reg`
- `Remove-CallumScout-Policy.reg`
- `callum-scout.crx`
- `updates.xml`
- `release.json`
- `.htaccess` when using Apache/cPanel
- `_headers` when using Cloudflare Pages

The `.crx` response must have the content type
`application/x-chrome-extension`. All URLs must stay on HTTPS and must be
publicly readable without a login or redirect to another hostname.

## First build

From `internal-vite-react-lead-operations`:

```powershell
npm run extension:test
npm run extension:selfhost
```

The build copies only the extension's required runtime files, adds the external
`update_url` to the staged manifest, and asks the installed Google Chrome binary
to create a CRX3 package. It creates the private signing key once at:

`.secrets/callum-scout-selfhost.pem`

Never upload or commit that PEM file. Back it up in the Codeblix secrets store.
Every future package must use the same key or Chrome will see it as a different
extension and existing installations will not update. Once `release.json`
exists, the build refuses to create a replacement key and refuses a key whose
extension ID differs from the published release.

## Publish an update

1. Increase `chrome-extension/manifest.json` version.
2. Run `npm run extension:test`.
3. Run `npm run extension:selfhost` using the existing private key.
4. Upload `callum-scout.crx` first.
5. Confirm its live SHA-256 equals `release.json`.
6. Upload `updates.xml` last.

The `.htaccess` and `_headers` files disable caching for release metadata and
the CRX so a new XML version cannot be paired with an old cached package.

## Live checks

```powershell
$release = Invoke-RestMethod https://extensions.codeblix.com/release.json
$crx = Invoke-WebRequest https://extensions.codeblix.com/callum-scout.crx
$crx.Headers.'Content-Type'
$release
```

Also test the full flow on a representative Windows scout PC:

1. Download and open `Install-CallumScout.reg` as an administrator.
2. Restart Chrome and check `chrome://policy` for `ExtensionInstallSources`.
3. Return to the install page and click **Install Callum Scout**.
4. Confirm Chrome shows its normal extension permission prompt.
5. Sign in to Callum Scout and run a safe, non-mutating check before normal use.

The registry file allows only the exact
`https://extensions.codeblix.com/*` source. It does not silently install the
extension. Chrome may display **Managed by your organization** while the policy
is present. `Remove-CallumScout-Policy.reg` removes the single value created by
the installer; it does not uninstall the extension itself.

## Move users to the Chrome Web Store

The self-hosted CRX and Chrome Web Store release have different signing keys,
so Chrome treats them as different extensions. After the unlisted listing is
approved, each scout should:

1. Stop any running Callum Scout workflow.
2. Remove the self-hosted extension ID `pobdcokoonabpchdmbdkofhahejecbck`
   from `chrome://extensions`.
3. Open `Remove-CallumScout-Policy.reg` to remove this install-source policy.
4. Install Callum Scout from the unlisted Web Store link.
5. Confirm only one Callum Scout extension is installed before resuming work.
