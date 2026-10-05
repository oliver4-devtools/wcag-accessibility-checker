/*!
 * Oliver4 WCAG Accessibility Checker - extension service worker
 * Version 1.5.5
 *
 *   1. On a toolbar click, runs oliver4-wcag-accessibility-checker.js in the
 *      page's main world, where window.Xrm is available.
 *   2. On a second click, the checker's re-run guard finds its host element
 *      and closes the panel.
 *   3. On failure, shows a badge on the toolbar button with the reason in its
 *      tooltip and in the service worker console.
 */

'use strict';

/* The checker script that runs in the page. */
var CHECKER_FILE = 'lib/oliver4-wcag-accessibility-checker.js';

/* ID of the checker's host element. Its presence in the DOM shows whether the
   panel is open. Matches HOST_ID in oliver4-wcag-accessibility-checker.js. */
var HOST_ID = 'oliver4-wcag-accessibility-host';

/* Schemes no extension may script, whatever permissions it holds. */
var BLOCKED_SCHEME = /^(chrome|edge|brave|opera|vivaldi|about|devtools|view-source|chrome-extension|extension|moz-extension|data|blob|filesystem):/i;

/* Browser storefronts, which Chrome and Edge protect the same way. */
var BLOCKED_HOST = /(^|\.)(chromewebstore\.google\.com|chrome\.google\.com|microsoftedge\.microsoft\.com)$/i;

/* Guidance appended to messages when the browser refuses access to a page. */
var OFF_LIMITS = 'Browser pages, the extensions page, the web store and PDF tabs are off limits to every extension. On any other page, make sure the page has finished loading and click the toolbar button again.';

chrome.action.onClicked.addListener(function (tab) {
  toggle(tab).catch(function (err) {
    /* Catches any failure not handled inside toggle() and logs it as an
       error. */
    report(tab && tab.id, 'Unexpected failure: ' + text(err), true);
  });
});

/* Clears the warning badge when the tab starts loading a new page. */
chrome.tabs.onUpdated.addListener(function (tabId, changeInfo) {
  if (changeInfo.status === 'loading') quiet(tabId);
});

chrome.runtime.onInstalled.addListener(function () {
  console.info('[Oliver4 WCAG Accessibility Checker] extension v' +
    chrome.runtime.getManifest().version + ' installed.');
});

/* ------------------------------------------------------------------ */
/* The toggle                                                          */
/* ------------------------------------------------------------------ */

async function toggle(tab) {
  var tabId = tab && tab.id;
  if (typeof tabId !== 'number' || tabId < 0) return;

  var refusal = refuse(tab.url || '');
  if (refusal) { report(tabId, refusal); return; }

  quiet(tabId);

  /* Checks whether the panel is open before and after injection, so a click
     that changes nothing is reported. The check runs in the isolated world
     and reads only the DOM. */
  var before;
  try {
    before = await panelOpen(tabId);
  } catch (err) {
    report(tabId, 'This page cannot be read by the extension. ' + OFF_LIMITS + ' ' + text(err));
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId, frameIds: [0] },
      world: 'MAIN',
      files: [CHECKER_FILE]
    });
  } catch (err) {
    report(tabId, 'The tool could not be injected into this page. ' + OFF_LIMITS + ' ' + text(err));
    return;
  }

  var after;
  try {
    after = await panelOpen(tabId);
  } catch (err) {
    /* The injection succeeded but the result cannot be confirmed, so no
       failure is reported. */
    return;
  }

  if (after === before) {
    report(tabId, after
      ? 'The panel is open but did not close. Press Escape with focus in the panel, or reload the page.'
      : 'The panel did not open. The page may still be loading, or its content security policy may have blocked the script. Reload the page and try again.');
    return;
  }

  if (after) {
    /* Logs a console line in the page confirming the checker was injected by
       the extension, with the extension version. */
    chrome.scripting.executeScript({
      target: { tabId: tabId, frameIds: [0] },
      world: 'MAIN',
      args: [chrome.runtime.getManifest().version],
      func: function (v) {
        console.info('[Oliver4 WCAG Accessibility Checker] injected by the ' +
          'browser extension, v' + v + '.');
      }
    }).catch(function () {});
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/* Resolves true if the checker's host element is present in the tab. */
function panelOpen(tabId) {
  return chrome.scripting.executeScript({
    target: { tabId: tabId, frameIds: [0] },
    args: [HOST_ID],
    func: function (id) { return !!document.getElementById(id); }
  }).then(function (frames) {
    return !!(frames && frames[0] && frames[0].result);
  });
}

/* Returns the reason this URL cannot be scripted, or '' if it can.
   An empty URL returns '' and any failure is reported by the injection
   step instead. */
function refuse(url) {
  if (!url) return '';
  if (BLOCKED_SCHEME.test(url)) {
    return 'Browser pages cannot be scripted by an extension. Open a Dynamics 365 page in a normal tab.';
  }
  if (url.slice(0, 5).toLowerCase() === 'file:') {
    return 'Local files need "Allow access to file URLs" switching on for this extension on the extensions page.';
  }
  var host = '';
  try { host = new URL(url).hostname; } catch (e) {}
  if (host && BLOCKED_HOST.test(host)) {
    return 'The browser blocks extensions from running on its own web store pages.';
  }
  return '';
}

/* Reports a failure: logs the message to the service worker console, sets a
   red "!" badge on the toolbar button for the tab, and puts the message in
   the button's tooltip. Logs with console.error when unexpected is true,
   otherwise with console.info. */
function report(tabId, message, unexpected) {
  var line = '[Oliver4 WCAG Accessibility Checker] ' + message;
  if (unexpected) console.error(line);
  else console.info(line);
  if (typeof tabId !== 'number' || tabId < 0) return;
  try {
    chrome.action.setBadgeText({ tabId: tabId, text: '!' });
    chrome.action.setBadgeBackgroundColor({ tabId: tabId, color: '#8a1c1c' });
    chrome.action.setTitle({
      tabId: tabId,
      title: 'Oliver4 WCAG Accessibility Checker\n\n' + message
    });
  } catch (e) {}
}

/* Clears the badge and resets the toolbar button tooltip for the tab. */
function quiet(tabId) {
  if (typeof tabId !== 'number' || tabId < 0) return;
  try {
    chrome.action.setBadgeText({ tabId: tabId, text: '' });
    chrome.action.setTitle({
      tabId: tabId,
      title: 'Oliver4 WCAG Accessibility Checker (open or close the panel)'
    });
  } catch (e) {}
}

/* Returns an error's message as a string. */
function text(err) {
  if (!err) return '';
  return String(err.message || err);
}
