const fs = require('node:fs');
const path = require('node:path');

function loadUrl(urlFilePath) {
  const text = fs.readFileSync(urlFilePath, 'utf8');
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const url = lines.find(
    (line) => line.startsWith('https://script.google.com/macros/s/') && line.endsWith('/exec'),
  );

  if (!url) {
    throw new Error(`No Google Apps Script exec URL found in ${urlFilePath}`);
  }

  return url;
}

async function requestJson(url, method, payload) {
  const options = {
    method,
    headers: {},
  };

  if (payload !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(payload);
  }

  const response = await fetch(url, options);
  const body = await response.text();
  return { status: response.status, body };
}

async function main() {
  const skillDir = path.resolve(__dirname, '..');
  const urlFilePath = path.join(skillDir, 'url.txt');

  let url;
  try {
    url = loadUrl(urlFilePath);
  } catch (error) {
    console.log(JSON.stringify({ success: false, stage: 'load_url', error: error.message }, null, 2));
    process.exitCode = 1;
    return;
  }

  const result = {
    success: true,
    url,
    checks: [],
  };

  try {
    const getResult = await requestJson(url, 'GET');
    result.checks.push({ method: 'GET', ...getResult });
  } catch (error) {
    console.log(JSON.stringify({ success: false, stage: 'get', url, error: error.message }, null, 2));
    process.exitCode = 1;
    return;
  }

  try {
    const postResult = await requestJson(url, 'POST', { action: 'ping' });
    result.checks.push({ method: 'POST', ...postResult });
  } catch (error) {
    console.log(JSON.stringify({ success: false, stage: 'post', url, error: error.message }, null, 2));
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify(result, null, 2));
}

main();
