import { createHash, createPublicKey } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const extensionRoot = path.join(projectRoot, "chrome-extension");
const outputRoot = path.join(projectRoot, "self-hosted-extension");
const secretsRoot = path.join(projectRoot, ".secrets");
const privateKeyPath = path.join(secretsRoot, "callum-scout-selfhost.pem");
const releaseMetadataPath = path.join(outputRoot, "release.json");

const defaultBaseUrl = "https://extensions.codeblix.com/";
const baseUrl = normalizeBaseUrl(
  process.env.CALLUM_SCOUT_SELF_HOST_BASE_URL || defaultBaseUrl,
);
const updateUrl = new URL("updates.xml", baseUrl).href;
const crxUrl = new URL("callum-scout.crx", baseUrl).href;
const installSource = `${baseUrl.href}*`;
// Chrome accepts any numeric registry value name for list policies. A large,
// product-specific slot avoids changing an organization's ordinary "1", "2",
// and similar ExtensionInstallSources entries.
const registryValueName = "19350127";

const runtimeFiles = [
  "automation.css",
  "automation.html",
  "automation.js",
  "background.js",
  "config.js",
  "content.css",
  "content.js",
  "convex-client.js",
  "dashboard.css",
  "dashboard.html",
  "dashboard.js",
  "help.css",
  "help.html",
  "icon.png",
  "manifest.json",
  "popup.css",
  "popup.html",
  "popup.js",
];

for (const file of runtimeFiles) {
  const sourcePath = path.join(extensionRoot, file);
  if (!existsSync(sourcePath)) {
    throw new Error(`Required extension file is missing: ${sourcePath}`);
  }
}

const sourceManifest = JSON.parse(
  readFileSync(path.join(extensionRoot, "manifest.json"), "utf8"),
);
const previousRelease = readPreviousRelease(releaseMetadataPath);
if (previousRelease && !existsSync(privateKeyPath)) {
  throw new Error(
    `The existing self-hosted extension signing key is missing: ${privateKeyPath}\n` +
      "Restore the original key instead of creating a new extension identity.",
  );
}
if (sourceManifest.manifest_version !== 3) {
  throw new Error("Callum Scout must remain a Manifest V3 extension.");
}
if (!/^\d+(?:\.\d+){0,3}$/.test(sourceManifest.version)) {
  throw new Error(`Invalid Chrome extension version: ${sourceManifest.version}`);
}

const workRoot = mkdtempSync(path.join(tmpdir(), "callum-scout-selfhost-"));
const stagedExtensionRoot = path.join(workRoot, "callum-scout");
const chromeProfileRoot = path.join(workRoot, "chrome-profile");
mkdirSync(stagedExtensionRoot, { recursive: true });
mkdirSync(chromeProfileRoot, { recursive: true });
mkdirSync(secretsRoot, { recursive: true });
mkdirSync(outputRoot, { recursive: true });

try {
  for (const file of runtimeFiles) {
    if (file !== "manifest.json") {
      copyFileSync(path.join(extensionRoot, file), path.join(stagedExtensionRoot, file));
    }
  }

  const selfHostedManifest = {
    ...sourceManifest,
    update_url: updateUrl,
  };
  writeFileSync(
    path.join(stagedExtensionRoot, "manifest.json"),
    `${JSON.stringify(selfHostedManifest, null, 2)}\n`,
    "utf8",
  );

  const chromePath = findChromeExecutable();
  const packArgs = [
    "--headless=new",
    "--no-first-run",
    "--disable-background-networking",
    `--user-data-dir=${chromeProfileRoot}`,
    `--pack-extension=${stagedExtensionRoot}`,
  ];
  if (existsSync(privateKeyPath)) {
    packArgs.push(`--pack-extension-key=${privateKeyPath}`);
  }

  const packed = spawnSync(chromePath, packArgs, {
    encoding: "utf8",
    timeout: 120_000,
    windowsHide: true,
  });
  if (packed.error) {
    throw packed.error;
  }
  if (packed.status !== 0) {
    const details = [packed.stdout, packed.stderr].filter(Boolean).join("\n").trim();
    throw new Error(
      `Chrome failed to pack Callum Scout (exit ${packed.status}).${details ? `\n${details}` : ""}`,
    );
  }

  const generatedCrxPath = `${stagedExtensionRoot}.crx`;
  const generatedKeyPath = `${stagedExtensionRoot}.pem`;
  if (!existsSync(generatedCrxPath)) {
    throw new Error(`Chrome did not create the expected CRX: ${generatedCrxPath}`);
  }
  if (!existsSync(privateKeyPath)) {
    if (!existsSync(generatedKeyPath)) {
      throw new Error("Chrome did not create the first-release signing key.");
    }
    renameSync(generatedKeyPath, privateKeyPath);
  }

  const privateKey = readFileSync(privateKeyPath, "utf8");
  const publicKeyDer = createPublicKey(privateKey).export({
    type: "spki",
    format: "der",
  });
  const extensionId = chromeExtensionId(publicKeyDer);
  if (previousRelease && previousRelease.extensionId !== extensionId) {
    throw new Error(
      `Signing key mismatch: expected ${previousRelease.extensionId}, received ${extensionId}.`,
    );
  }
  const crx = readFileSync(generatedCrxPath);
  verifyCrxHeader(crx);
  const crxSha256 = createHash("sha256").update(crx).digest("hex");

  copyFileSync(generatedCrxPath, path.join(outputRoot, "callum-scout.crx"));
  writeFileSync(
    path.join(outputRoot, "updates.xml"),
    createUpdateXml({
      extensionId,
      version: sourceManifest.version,
      crxUrl,
    }),
    "utf8",
  );
  writeFileSync(
    path.join(outputRoot, "Install-CallumScout.reg"),
    createInstallRegistryFile(installSource, registryValueName),
    "utf16le",
  );
  writeFileSync(
    path.join(outputRoot, "Remove-CallumScout-Policy.reg"),
    createRemoveRegistryFile(registryValueName),
    "utf16le",
  );
  writeFileSync(
    path.join(outputRoot, "index.html"),
    createInstallPage({
      extensionId,
      version: sourceManifest.version,
      installSource,
    }),
    "utf8",
  );
  writeFileSync(path.join(outputRoot, ".htaccess"), apacheConfig(), "utf8");
  writeFileSync(path.join(outputRoot, "_headers"), cloudflareHeaders(), "utf8");
  writeFileSync(
    releaseMetadataPath,
    `${JSON.stringify(
      {
        name: sourceManifest.name,
        version: sourceManifest.version,
        extensionId,
        baseUrl: baseUrl.href,
        updateUrl,
        crxUrl,
        crxSha256,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  verifyGeneratedRelease({
    extensionId,
    version: sourceManifest.version,
    crxSha256,
  });

  console.log(`Self-hosted Callum Scout ${sourceManifest.version} is ready.`);
  console.log(`Extension ID: ${extensionId}`);
  console.log(`CRX SHA-256: ${crxSha256}`);
  console.log(`Output: ${outputRoot}`);
  console.log(`Signing key: ${privateKeyPath} (private; never upload or commit)`);
} finally {
  rmSync(workRoot, { recursive: true, force: true });
}

function normalizeBaseUrl(value) {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:") {
    throw new Error("The self-hosted extension URL must use HTTPS.");
  }
  if (parsed.search || parsed.hash) {
    throw new Error("The self-hosted extension URL cannot contain a query or hash.");
  }
  parsed.pathname = `${parsed.pathname.replace(/\/+$/, "")}/`;
  return parsed;
}

function readPreviousRelease(releasePath) {
  if (!existsSync(releasePath)) {
    return undefined;
  }
  const release = JSON.parse(readFileSync(releasePath, "utf8"));
  if (!/^[a-p]{32}$/.test(release.extensionId || "")) {
    throw new Error(`Existing release metadata has an invalid extension ID: ${releasePath}`);
  }
  return release;
}

function findChromeExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe")
      : undefined,
  ].filter(Boolean);
  const chromePath = candidates.find((candidate) => existsSync(candidate));
  if (!chromePath) {
    throw new Error(
      "Google Chrome was not found. Set CHROME_PATH to the full path of chrome.exe.",
    );
  }
  return chromePath;
}

function chromeExtensionId(publicKeyDer) {
  const hex = createHash("sha256")
    .update(publicKeyDer)
    .digest("hex")
    .slice(0, 32);
  return [...hex]
    .map((character) => String.fromCharCode(97 + Number.parseInt(character, 16)))
    .join("");
}

function verifyCrxHeader(crx) {
  if (crx.length < 12 || crx.subarray(0, 4).toString("ascii") !== "Cr24") {
    throw new Error("Chrome produced a file without a valid CRX header.");
  }
  if (crx.readUInt32LE(4) !== 3) {
    throw new Error(`Expected a CRX3 package; received CRX${crx.readUInt32LE(4)}.`);
  }
}

function createUpdateXml({ extensionId, version, crxUrl }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">
  <app appid="${extensionId}">
    <updatecheck codebase="${escapeXml(crxUrl)}" version="${version}" />
  </app>
</gupdate>
`;
}

function createInstallRegistryFile(allowedSource, valueName) {
  return `\ufeffWindows Registry Editor Version 5.00\r\n\r\n[HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Google\\Chrome\\ExtensionInstallSources]\r\n"${valueName}"="${escapeRegistryString(allowedSource)}"\r\n`;
}

function createRemoveRegistryFile(valueName) {
  return `\ufeffWindows Registry Editor Version 5.00\r\n\r\n[HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Google\\Chrome\\ExtensionInstallSources]\r\n"${valueName}"=-\r\n`;
}

function createInstallPage({ extensionId, version, installSource }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Install Callum Scout</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #f4f6f8; color: #15202b; }
    main { width: min(760px, calc(100% - 32px)); margin: 48px auto; }
    .card { overflow: hidden; background: #fff; border: 1px solid #dce3e8; border-radius: 20px; box-shadow: 0 18px 55px rgba(24, 39, 55, .09); }
    header { padding: 32px; color: #fff; background: #0b3b35; }
    .eyebrow { margin: 0 0 10px; color: #a9e7d9; font-size: 13px; font-weight: 750; letter-spacing: .1em; text-transform: uppercase; }
    h1 { margin: 0; font-size: clamp(30px, 6vw, 46px); letter-spacing: -.04em; }
    header p { max-width: 560px; margin: 14px 0 0; color: #d8eee9; line-height: 1.55; }
    .steps { display: grid; gap: 0; margin: 0; padding: 0; list-style: none; }
    .step { display: grid; grid-template-columns: 42px 1fr; gap: 16px; padding: 26px 32px; border-top: 1px solid #e8edf0; }
    .step:first-child { border-top: 0; }
    .number { display: grid; width: 42px; height: 42px; place-items: center; border-radius: 50%; background: #e1f5ef; color: #0b6457; font-weight: 800; }
    h2 { margin: 1px 0 7px; font-size: 19px; }
    p { margin: 0; color: #53616c; line-height: 1.55; }
    .step code { overflow-wrap: anywhere; color: #20483f; font-size: .9em; }
    .button { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; margin-top: 16px; padding: 0 18px; border-radius: 10px; background: #0c6f60; color: #fff; font-weight: 750; text-decoration: none; }
    .button.secondary { border: 1px solid #b9c8ce; background: #fff; color: #263842; }
    .note { margin: 0 32px 32px; padding: 18px; border-radius: 12px; background: #f2f7f6; color: #45565f; font-size: 14px; line-height: 1.55; }
    .meta { display: flex; flex-wrap: wrap; gap: 10px 18px; padding: 18px 32px; border-top: 1px solid #e8edf0; color: #77848c; font-size: 12px; }
    .meta code { overflow-wrap: anywhere; }
    @media (max-width: 560px) { main { margin: 16px auto; } header, .step { padding: 24px 20px; } .note { margin: 0 20px 24px; } .meta { padding: 18px 20px; } }
  </style>
</head>
<body>
  <main>
    <section class="card">
      <header>
        <p class="eyebrow">Codeblix private distribution</p>
        <h1>Install Callum Scout</h1>
        <p>Use this temporary Windows installation while the unlisted Chrome Web Store release is under review.</p>
      </header>
      <ol class="steps">
        <li class="step">
          <span class="number">1</span>
          <div>
            <h2>Allow this Codeblix download location</h2>
            <p>Download the plain-text registry file, open it, and approve the Windows prompts. Administrator permission is required.</p>
            <a class="button secondary" href="Install-CallumScout.reg" download>Download install policy</a>
          </div>
        </li>
        <li class="step">
          <span class="number">2</span>
          <div>
            <h2>Restart Chrome</h2>
            <p>Close every Chrome window and open Chrome again. Before continuing, open <code>chrome://policy</code> and confirm <strong>ExtensionInstallSources</strong> contains <code>${escapeHtml(installSource)}</code> with status OK.</p>
          </div>
        </li>
        <li class="step">
          <span class="number">3</span>
          <div>
            <h2>Add Callum Scout</h2>
            <p>Chrome will show the extension permissions and ask you to confirm. If it says “Download suspicious file” instead, stop—the policy has not loaded correctly.</p>
            <a class="button" href="callum-scout.crx">Install Callum Scout</a>
          </div>
        </li>
      </ol>
      <p class="note"><strong>Expected Chrome message:</strong> Chrome may say “Managed by your organization” because the first file adds one Chrome installation policy. It does not install hidden software. To remove that policy later, download and open <a href="Remove-CallumScout-Policy.reg" download>Remove-CallumScout-Policy.reg</a>. When the Chrome Web Store release is approved, remove this self-hosted copy before installing the Store copy so both cannot run at once.</p>
      <footer class="meta">
        <span>Version ${escapeHtml(version)}</span>
        <span>Extension ID <code>${escapeHtml(extensionId)}</code></span>
        <span>Automatic updates enabled</span>
      </footer>
    </section>
  </main>
</body>
</html>
`;
}

function apacheConfig() {
  return `Options -Indexes
AddType application/x-chrome-extension .crx
AddType application/xml .xml
AddType application/octet-stream .reg

<IfModule mod_headers.c>
  Header always set X-Content-Type-Options "nosniff"
  Header always set Referrer-Policy "same-origin"
  <FilesMatch "\\.(crx|xml|reg|json)$">
    Header set Cache-Control "no-store, max-age=0"
  </FilesMatch>
  <FilesMatch "\\.reg$">
    Header set Content-Disposition "attachment"
  </FilesMatch>
</IfModule>
`;
}

function cloudflareHeaders() {
  return `/*.crx
  Content-Type: application/x-chrome-extension
  Cache-Control: no-store, max-age=0
  X-Content-Type-Options: nosniff

/*.xml
  Content-Type: application/xml; charset=utf-8
  Cache-Control: no-store, max-age=0
  X-Content-Type-Options: nosniff

/*.reg
  Content-Type: application/octet-stream
  Content-Disposition: attachment
  Cache-Control: no-store, max-age=0

/*
  Referrer-Policy: same-origin
  X-Content-Type-Options: nosniff
`;
}

function verifyGeneratedRelease({ extensionId, version, crxSha256 }) {
  const xml = readFileSync(path.join(outputRoot, "updates.xml"), "utf8");
  if (!xml.includes(`appid="${extensionId}"`) || !xml.includes(`version="${version}"`)) {
    throw new Error("Generated update manifest does not match the signed package.");
  }
  const writtenCrx = readFileSync(path.join(outputRoot, "callum-scout.crx"));
  const writtenHash = createHash("sha256").update(writtenCrx).digest("hex");
  if (writtenHash !== crxSha256) {
    throw new Error("Generated CRX hash changed while writing the release.");
  }
  for (const file of [
    "callum-scout.crx",
    "updates.xml",
    "Install-CallumScout.reg",
    "Remove-CallumScout-Policy.reg",
    "index.html",
    ".htaccess",
    "_headers",
    "release.json",
  ]) {
    if (!existsSync(path.join(outputRoot, file))) {
      throw new Error(`Generated hosting file is missing: ${file}`);
    }
  }
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeHtml(value) {
  return escapeXml(String(value)).replaceAll("'", "&#39;");
}

function escapeRegistryString(value) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}
