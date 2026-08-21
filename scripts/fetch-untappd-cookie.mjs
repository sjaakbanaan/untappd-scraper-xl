#!/usr/bin/env node

/**
 * Fetches the current Untappd Cookie header from a local browser profile and
 * writes it to .env as UNTAPPD_COOKIE="...".
 *
 * Support:
 *   - macOS, Linux, Windows
 *   - Chromium browsers: Chrome, Brave, Edge, Chromium, Arc where available
 *   - Firefox
 */

import crypto from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const UNTAPPD_HOSTS = [
  'untappd.com',
  '.untappd.com',
  'www.untappd.com',
  '.www.untappd.com',
];

const REQUIRED_COOKIE_NAMES = ['cf_clearance', 'ut_d_l', '_ALGOLIA'];

const CHROMIUM_BROWSERS = [
  {
    id: 'chrome',
    label: 'Google Chrome',
    baseDirs: {
      darwin: '~/Library/Application Support/Google/Chrome',
      linux: '~/.config/google-chrome',
      win32: '%LOCALAPPDATA%\\Google\\Chrome\\User Data',
    },
    safeStorageService: 'Chrome Safe Storage',
    safeStorageAccount: 'Chrome',
    linuxSecretApplications: ['chrome', 'google-chrome'],
  },
  {
    id: 'brave',
    label: 'Brave',
    baseDirs: {
      darwin: '~/Library/Application Support/BraveSoftware/Brave-Browser',
      linux: '~/.config/BraveSoftware/Brave-Browser',
      win32: '%LOCALAPPDATA%\\BraveSoftware\\Brave-Browser\\User Data',
    },
    safeStorageService: 'Brave Safe Storage',
    safeStorageAccount: 'Brave',
    linuxSecretApplications: ['brave', 'Brave'],
  },
  {
    id: 'edge',
    label: 'Microsoft Edge',
    baseDirs: {
      darwin: '~/Library/Application Support/Microsoft Edge',
      linux: '~/.config/microsoft-edge',
      win32: '%LOCALAPPDATA%\\Microsoft\\Edge\\User Data',
    },
    safeStorageService: 'Microsoft Edge Safe Storage',
    safeStorageAccount: 'Microsoft Edge',
    linuxSecretApplications: ['microsoft-edge', 'edge'],
  },
  {
    id: 'arc',
    label: 'Arc',
    baseDirs: {
      darwin: '~/Library/Application Support/Arc/User Data',
      win32:
        '%LOCALAPPDATA%\\Packages\\TheBrowserCompany.Arc_ttt1ap7aakyb4\\LocalCache\\Local\\Arc\\User Data',
    },
    safeStorageService: 'Arc Safe Storage',
    safeStorageAccount: 'Arc',
    linuxSecretApplications: ['arc'],
  },
  {
    id: 'chromium',
    label: 'Chromium',
    baseDirs: {
      darwin: '~/Library/Application Support/Chromium',
      linux: '~/.config/chromium',
      win32: '%LOCALAPPDATA%\\Chromium\\User Data',
    },
    safeStorageService: 'Chromium Safe Storage',
    safeStorageAccount: 'Chromium',
    linuxSecretApplications: ['chromium'],
  },
];

const FIREFOX_BROWSER = {
  id: 'firefox',
  label: 'Firefox',
  baseDirs: {
    darwin: '~/Library/Application Support/Firefox/Profiles',
    linux: '~/.mozilla/firefox',
    win32: '%APPDATA%\\Mozilla\\Firefox\\Profiles',
  },
};

function usage() {
  console.log(`Usage: npm run cookie -- [options]

Options:
  --browser <name>   Browser to scan: all, chrome, brave, edge, arc, chromium, firefox
  --profile <name>   Browser profile directory, e.g. "Default" or "Profile 1"
  --env <path>       Env file to update (default: .env)
  --print            Print only the cookie header instead of updating .env
  --dry-run          Find the cookie without writing .env
  --help             Show this help
`);
}

function parseArgs(argv) {
  const options = {
    browser: 'all',
    profile: null,
    envPath: '.env',
    print: false,
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else if (arg === '--print') {
      options.print = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--browser') {
      options.browser = argv[++index];
    } else if (arg.startsWith('--browser=')) {
      options.browser = arg.slice('--browser='.length);
    } else if (arg === '--profile') {
      options.profile = argv[++index];
    } else if (arg.startsWith('--profile=')) {
      options.profile = arg.slice('--profile='.length);
    } else if (arg === '--env') {
      options.envPath = argv[++index];
    } else if (arg.startsWith('--env=')) {
      options.envPath = arg.slice('--env='.length);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function expandHome(filePath) {
  return filePath
    .replace(/^~(?=$|\/|\\)/, os.homedir())
    .replace(/%([^%]+)%/g, (_match, name) => process.env[name] ?? '');
}

function browserBaseDir(browser) {
  const baseDir = browser.baseDirs[process.platform];
  return baseDir ? expandHome(baseDir) : null;
}

function copySqliteDatabase(sourcePath) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'untappd-cookies-'));
  const targetPath = path.join(tempDir, path.basename(sourcePath));
  copyFileSync(sourcePath, targetPath);

  for (const suffix of ['-wal', '-shm']) {
    const sidecarPath = `${sourcePath}${suffix}`;
    if (existsSync(sidecarPath)) {
      copyFileSync(sidecarPath, `${targetPath}${suffix}`);
    }
  }

  return { tempDir, targetPath };
}

function sqliteJson(databasePath, sql) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return database.prepare(sql).all();
  } finally {
    database.close();
  }
}

function quoteSql(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

function getChromeTimeNow() {
  const epochOffsetMicroseconds = 11644473600000000n;
  return (BigInt(Date.now()) * 1000n + epochOffsetMicroseconds).toString();
}

function untappdHostFilter(column) {
  return `(${UNTAPPD_HOSTS.map((host) => `${column} = ${quoteSql(host)}`).join(
    ' OR '
  )})`;
}

function requiredCookieFilter(column) {
  return `(${REQUIRED_COOKIE_NAMES.map(
    (name) => `${column} = ${quoteSql(name)}`
  ).join(' OR ')})`;
}

function listChromiumProfiles(browser, wantedProfile) {
  const baseDir = browserBaseDir(browser);
  if (!baseDir || !existsSync(baseDir)) return [];

  const candidates = readdirSync(baseDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !wantedProfile || name === wantedProfile)
    .flatMap((name) => {
      const profileDir = path.join(baseDir, name);
      return ['Network/Cookies', 'Cookies']
        .map((relativePath) => path.join(profileDir, relativePath))
        .filter((cookiePath) => existsSync(cookiePath))
        .map((cookiePath) => ({
          name,
          cookiePath,
          localStatePath: path.join(baseDir, 'Local State'),
        }));
    });

  return candidates.sort((a, b) => profileSortScore(a.name) - profileSortScore(b.name));
}

function profileSortScore(profileName) {
  if (profileName === 'Default') return 0;
  if (/^Profile \d+$/.test(profileName)) return 1;
  return 2;
}

function getMacSafeStoragePassword(browser) {
  const args = [
    'find-generic-password',
    '-w',
    '-s',
    browser.safeStorageService,
    '-a',
    browser.safeStorageAccount,
  ];

  try {
    return execFileSync('security', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return execFileSync(
      'security',
      ['find-generic-password', '-w', '-s', browser.safeStorageService],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }
    ).trim();
  }
}

function getLinuxSafeStoragePassword(browser) {
  const applications = browser.linuxSecretApplications ?? [browser.id];
  const candidates = applications.flatMap((application) => [
    ['lookup', 'application', application],
    ['lookup', 'xdg:schema', 'chrome_libsecret_os_crypt_password', 'application', application],
  ]);

  for (const args of candidates) {
    try {
      const password = execFileSync('secret-tool', args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (password) return password;
    } catch {
      // Fall back to Chromium's historical plaintext key below.
    }
  }

  return 'peanuts';
}

function getChromiumAesCbcPassword(browser) {
  if (process.platform === 'darwin') return getMacSafeStoragePassword(browser);
  if (process.platform === 'linux') return getLinuxSafeStoragePassword(browser);
  return null;
}

function getChromiumLocalStateKey(localStatePath) {
  if (!localStatePath || !existsSync(localStatePath)) return null;

  const localState = JSON.parse(readFileSync(localStatePath, 'utf8'));
  const encryptedKey = localState.os_crypt?.encrypted_key;
  if (!encryptedKey) return null;

  const encryptedKeyBytes = Buffer.from(encryptedKey, 'base64');
  if (process.platform === 'win32') {
    const dpapiPrefix = Buffer.from('DPAPI');
    const protectedBytes = encryptedKeyBytes.subarray(
      encryptedKeyBytes.subarray(0, dpapiPrefix.length).equals(dpapiPrefix)
        ? dpapiPrefix.length
        : 0
    );
    return decryptWindowsDpapi(protectedBytes);
  }

  return encryptedKeyBytes;
}

function decryptChromiumCookie(row, browser, profile) {
  if (row.value) return row.value;
  if (!row.encrypted_hex) return '';

  const encryptedValue = Buffer.from(row.encrypted_hex, 'hex');
  const prefix = encryptedValue.subarray(0, 3).toString();

  if (process.platform === 'win32') {
    if (prefix === 'v20') {
      throw new Error(
        'Chrome-family cookies use Windows App-Bound Encryption in this profile. Try Firefox, or use the manual DevTools copy flow.'
      );
    }

    if (prefix === 'v10' || prefix === 'v11') {
      const key = getChromiumLocalStateKey(profile.localStatePath);
      if (!key) {
        throw new Error('Could not find a Chromium Local State encryption key.');
      }
      return cleanDecryptedCookie(row.host_key, decryptAesGcm(encryptedValue, key));
    }

    return cleanDecryptedCookie(row.host_key, decryptWindowsDpapi(encryptedValue));
  }

  const cbcPassword = getChromiumAesCbcPassword(browser);
  if (!cbcPassword) return '';

  return cleanDecryptedCookie(row.host_key, decryptChromiumAesCbc(encryptedValue, cbcPassword));
}

function decryptAesGcm(encryptedValue, key) {
  const nonce = encryptedValue.subarray(3, 15);
  const ciphertext = encryptedValue.subarray(15, encryptedValue.length - 16);
  const authTag = encryptedValue.subarray(encryptedValue.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function decryptWindowsDpapi(protectedBytes) {
  const base64Payload = protectedBytes.toString('base64');
  const command = `
    Add-Type -AssemblyName System.Security;
    $bytes = [Convert]::FromBase64String('${base64Payload}');
    $plain = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, 'CurrentUser');
    [Convert]::ToBase64String($plain);
  `;
  const executable = process.env.SystemRoot
    ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : 'powershell.exe';
  const output = execFileSync(
    executable,
    ['-NoProfile', '-NonInteractive', '-Command', command],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }
  ).trim();

  return Buffer.from(output, 'base64');
}

function decryptChromiumAesCbc(encryptedValue, safeStoragePassword) {
  const encryptedPayload = /^v\d\d/.test(encryptedValue.subarray(0, 3).toString())
    ? encryptedValue.subarray(3)
    : encryptedValue;

  const key = crypto.pbkdf2Sync(
    safeStoragePassword,
    'saltysalt',
    process.platform === 'darwin' ? 1003 : 1,
    16,
    'sha1'
  );
  const iv = Buffer.from(' '.repeat(16), 'utf8');
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
  decipher.setAutoPadding(false);

  return removePkcs7Padding(
    Buffer.concat([decipher.update(encryptedPayload), decipher.final()])
  );
}

function cleanDecryptedCookie(hostKey, decrypted) {
  const hostDigest = crypto.createHash('sha256').update(hostKey).digest();

  if (decrypted.subarray(0, hostDigest.length).equals(hostDigest)) {
    return decrypted.subarray(hostDigest.length).toString('utf8');
  }

  return decrypted.toString('utf8');
}

function removePkcs7Padding(buffer) {
  const paddingLength = buffer[buffer.length - 1];
  if (paddingLength < 1 || paddingLength > 16) return buffer;
  return buffer.subarray(0, buffer.length - paddingLength);
}

function readChromiumCookies(browser, profile) {
  const { tempDir, targetPath } = copySqliteDatabase(profile.cookiePath);

  try {
    const rows = sqliteJson(
      targetPath,
      `
        SELECT host_key, name, path, value, hex(encrypted_value) AS encrypted_hex,
               is_secure, is_httponly
        FROM cookies
          WHERE ${untappdHostFilter('host_key')}
          AND ${requiredCookieFilter('name')}
          AND (expires_utc = 0 OR expires_utc > ${getChromeTimeNow()})
        ORDER BY length(path) DESC, creation_utc ASC;
      `
    );

    if (rows.length === 0) return [];

    return rows
      .map((row) => ({
        name: row.name,
        value: decryptChromiumCookie(row, browser, profile),
      }))
      .filter((cookie) => cookie.name && cookie.value);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function listFirefoxProfiles(wantedProfile) {
  const baseDir = browserBaseDir(FIREFOX_BROWSER);
  if (!baseDir || !existsSync(baseDir)) return [];

  return readdirSync(baseDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !wantedProfile || name === wantedProfile)
    .map((name) => ({
      name,
      cookiePath: path.join(baseDir, name, 'cookies.sqlite'),
    }))
    .filter((profile) => existsSync(profile.cookiePath));
}

function readFirefoxCookies(profile) {
  const { tempDir, targetPath } = copySqliteDatabase(profile.cookiePath);

  try {
    return sqliteJson(
      targetPath,
      `
        SELECT name, value, path, isSecure, isHttpOnly, creationTime
        FROM moz_cookies
        WHERE ${untappdHostFilter('host')}
          AND ${requiredCookieFilter('name')}
          AND (expiry = 0 OR expiry > strftime('%s', 'now'))
        ORDER BY length(path) DESC, creationTime ASC;
      `
    ).filter((cookie) => cookie.name && cookie.value);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function cookieHeaderFromCookies(cookies) {
  const cookiesByName = new Map();

  for (const cookie of cookies) {
    if (!REQUIRED_COOKIE_NAMES.includes(cookie.name)) continue;
    if (!cookiesByName.has(cookie.name)) cookiesByName.set(cookie.name, cookie);
  }

  if (!REQUIRED_COOKIE_NAMES.every((name) => cookiesByName.has(name))) return '';

  return REQUIRED_COOKIE_NAMES
    .map((name) => cookiesByName.get(name))
    .filter(Boolean)
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

function findUntappdCookieHeader(options) {
  const requestedBrowser = options.browser.toLowerCase();
  const browsers =
    requestedBrowser === 'all'
      ? [...CHROMIUM_BROWSERS, FIREFOX_BROWSER]
      : [...CHROMIUM_BROWSERS, FIREFOX_BROWSER].filter(
          (browser) => browser.id === requestedBrowser
        );

  if (browsers.length === 0) {
    throw new Error(`Unknown browser "${options.browser}". Use --help for choices.`);
  }

  const attempts = [];

  for (const browser of browsers) {
    const profiles =
      browser.id === 'firefox'
        ? listFirefoxProfiles(options.profile)
        : listChromiumProfiles(browser, options.profile);

    for (const profile of profiles) {
      attempts.push(`${browser.label}/${profile.name}`);
      let cookies;
      try {
        cookies =
          browser.id === 'firefox'
            ? readFirefoxCookies(profile)
            : readChromiumCookies(browser, profile);
      } catch (error) {
        console.warn(
          `Warning: could not read ${browser.label}/${profile.name}: ${error.message}`
        );
        continue;
      }

      const cookieHeader = cookieHeaderFromCookies(cookies);
      if (cookieHeader) {
        return {
          browser: browser.label,
          profile: profile.name,
          cookieHeader,
          cookieCount: cookies.length,
        };
      }
    }
  }

  const searched = attempts.length ? attempts.join(', ') : 'no browser profiles found';
  throw new Error(
    `No Untappd cookies found. Searched: ${searched}. Make sure you are logged in on untappd.com.`
  );
}

function quoteEnvValue(value) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function updateEnvFile(envPath, cookieHeader) {
  const resolvedEnvPath = path.resolve(envPath);
  const templatePath = path.resolve('.env.example');
  let contents = '';

  if (existsSync(resolvedEnvPath)) {
    contents = readFileSync(resolvedEnvPath, 'utf8');
  } else if (existsSync(templatePath)) {
    contents = readFileSync(templatePath, 'utf8');
  }

  const nextLine = `UNTAPPD_COOKIE=${quoteEnvValue(cookieHeader)}`;

  if (/^UNTAPPD_COOKIE=.*$/m.test(contents)) {
    contents = contents.replace(/^UNTAPPD_COOKIE=.*$/m, nextLine);
  } else {
    contents = `${contents.replace(/\s*$/, '')}\n${nextLine}\n`;
  }

  writeFileSync(resolvedEnvPath, contents);
  return resolvedEnvPath;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const result = findUntappdCookieHeader(options);

  if (options.print) {
    process.stdout.write(`${result.cookieHeader}\n`);
    return;
  }

  console.log(`Found ${result.cookieCount} required Untappd cookie(s).`);
  console.log(`Source: ${result.browser}/${result.profile}`);

  if (options.dryRun) {
    console.log('Dry run only. .env was not changed.');
    return;
  }

  const envPath = updateEnvFile(options.envPath, result.cookieHeader);
  console.log(`Updated ${envPath}`);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
