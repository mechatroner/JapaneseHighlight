import browser from 'webextension-polyfill';
import { saveAs } from './lib/FileSaver';
import { makeHlStyle, localizeHtmlPage } from './lib/common_lib';
import { initContextMenus, makeDefaultOnlineDicts } from './lib/context_menu_lib';

let wdHlSettings = null;
let wdHoverSettings = null;
let wdOnlineDicts = null;
let wdEnableTTS = false;

const wcRbIds = ['wc1', 'wc2', 'wc3', 'wc4', 'wc5'];
// var ic_rb_ids = ['ic1', 'ic2', 'ic3', 'ic4', 'ic5'];
const wbRbIds = ['wb1', 'wb2', 'wb3', 'wb4', 'wb5'];
// var ib_rb_ids = ['ib1', 'ib2', 'ib3', 'ib4', 'ib5'];

const hoverPopupTypes = ['never', 'key', 'always'];
const targetTypes = ['hl', 'ow'];

function displaySyncInterface() {
  browser.storage.local.get(['wdGdSyncEnabled', 'wdLastSyncError', 'wdLastSync']).then((result) => {
    const { wdLastSyncError, wdGdSyncEnabled, wdLastSync } = result;
    if (!wdGdSyncEnabled) {
      document.getElementById('gd-stop-sync-button').style.display = 'none';
      document.getElementById('sync-status-feedback').style.display = 'none';
      return;
    }
    document.getElementById('gd-stop-sync-button').style.display = 'inline-block';
    document.getElementById('sync-status-feedback').style.display = 'inline';
    if (wdLastSyncError != null) {
      document.getElementById('sync-status-feedback').textContent = `Error: ${wdLastSyncError}`;
    } else {
      document.getElementById('sync-status-feedback').textContent = 'Synchronized.';
    }
    if (typeof wdLastSync !== 'undefined') {
      const curDate = new Date();
      let secondsPassed = (curDate.getTime() - wdLastSync) / 1000;
      const pDays = Math.floor(secondsPassed / (3600 * 24));
      secondsPassed %= 3600 * 24;
      const pHours = Math.floor(secondsPassed / 3600);
      secondsPassed %= 3600;
      const pMinutes = Math.floor(secondsPassed / 60);
      const pSeconds = Math.floor(secondsPassed % 60);
      let passedTimeMsg = '';
      if (pDays > 0) passedTimeMsg += `${pDays} days, `;
      if (pHours > 0 || pDays > 0) passedTimeMsg += `${pHours} hours, `;
      if (pMinutes > 0 || pHours > 0 || pDays > 0) passedTimeMsg += `${pMinutes} minutes, `;
      passedTimeMsg += `${pSeconds} seconds since the last sync.`;
      const syncDateLabel = document.getElementById('last-sync-date');
      syncDateLabel.style.display = 'inline';
      syncDateLabel.textContent = passedTimeMsg;
    }
  });
}

function synchronizeNow() {
  browser.runtime.onMessage.addListener((request) => {
    if (request.sync_feedback) {
      displaySyncInterface();
    }
  });
  document.getElementById('sync-status-feedback').style.display = 'inline';
  document.getElementById('sync-status-feedback').textContent = 'Synchronization started...';
  browser.storage.local.set({ wdGdSyncEnabled: true }).then(() => {
    browser.runtime.sendMessage({ wdm_request: 'gd_sync', interactive_mode: true });
  });
}

function requestPermissionsAndSync() {
  browser.permissions.request({ origins: ['https://*/*'] }).then((granted) => {
    if (!granted) return;
    synchronizeNow();
  });
}

function stopSynchronization() {
  browser.storage.local.set({ wdGdSyncEnabled: false }).then(() => {
    displaySyncInterface();
  });
}

function processTestWarnings() {
  browser.management.getPermissionWarningsByManifest(prompt(), console.log);
}

function processGetDbg() {
  const storageKey = document.getElementById('get-from-storage-key').value;
  browser.storage.local.get([storageKey]).then((result) => {
    const storageValue = result[storageKey];
    console.log(`key: ${storageKey}; value: ${JSON.stringify(storageValue)}`);
  });
}

function processSetDbg() {
  console.log('processing dbg');
  const storageKey = document.getElementById('set-to-storage-key').value;
  let storageValue = document.getElementById('set-to-storage-val').value;
  if (storageValue === 'undefined') {
    storageValue = undefined;
  } else {
    storageValue = JSON.parse(storageValue);
  }
  console.log(`storage_key:${storageKey}, storage_value:${storageValue}`);
  browser.storage.local.set({ [storageKey]: storageValue }).then(() => {
    const { lastError } = browser.runtime;
    console.log(`last_error:${lastError}`);
    console.log('finished setting value');
  });
}

function processExport() {
  browser.storage.local.get(['wdUserVocabulary']).then((result) => {
    const userVocabulary = result.wdUserVocabulary;
    const keys = [];
    // for (const key in user_vocabulary) {
    Object.keys(userVocabulary).forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(userVocabulary, key)) {
        keys.push(key);
      }
    });
    const fileContent = keys.join('\r\n');
    const blob = new Blob([fileContent], {
      type: 'text/plain;charset=utf-8',
    });
    saveAs(blob, 'japanese_vocabulary.txt', true);
  });
}

function processImport() {
  browser.tabs.create({
    url: browser.extension.getURL('../html/import.html'),
  });
}

function highlightExampleText(hlParams, textId, lqId, rqId) {
  document.getElementById(lqId).textContent = '';
  document.getElementById(rqId).textContent = '';
  document.getElementById(lqId).style = undefined;
  document.getElementById(rqId).style = undefined;
  document.getElementById(textId).style = makeHlStyle(hlParams);
}

function showRbStates(ids, color) {
  for (let i = 0; i < ids.length; i += 1) {
    const docElement = document.getElementById(ids[i]);
    if (docElement.label.style.backgroundColor === color) {
      docElement.checked = true;
    }
  }
}

function processTestOldDict(e) {
  const button = e.target;
  const btnId = button.id;
  if (!btnId.startsWith('testDictBtn_')) return;
  const btnNo = parseInt(btnId.split('_')[1], 10);
  const url = `${wdOnlineDicts[btnNo].url}test`;
  browser.tabs.create({ url });
}

function showUserDicts() {
  const dictsBlock = document.getElementById('existing-dicts-block');
  while (dictsBlock.firstChild) {
    dictsBlock.removeChild(dictsBlock.firstChild);
  }
  const dictPairs = wdOnlineDicts;
  for (let i = 0; i < dictPairs.length; i += 1) {
    const nameSpan = document.createElement('span');
    nameSpan.setAttribute('class', 'existing-dict-name');
    nameSpan.textContent = dictPairs[i].title;
    dictsBlock.appendChild(nameSpan);

    const urlInput = document.createElement('input');
    urlInput.setAttribute('type', 'text');
    urlInput.setAttribute('class', 'existing-dict-url');
    urlInput.setAttribute('value', dictPairs[i].url);
    urlInput.readOnly = true;
    dictsBlock.appendChild(urlInput);

    const testButton = document.createElement('button');
    testButton.setAttribute('class', 'short-button');
    testButton.id = `testDictBtn_${i}`;
    testButton.textContent = 'Test';
    testButton.addEventListener('click', processTestOldDict);
    dictsBlock.appendChild(testButton);

    const deleteButton = document.createElement('button');
    deleteButton.setAttribute('class', 'imgButton');
    deleteButton.id = `delDictBtn_${i}`;
    const img = document.createElement('img');
    img.setAttribute('src', '../images/delete.png');
    img.id = `delDictImg_${i}`;
    deleteButton.appendChild(img);
    deleteButton.addEventListener('click', processDeleteOldDict);
    dictsBlock.appendChild(deleteButton);

    dictsBlock.appendChild(document.createElement('br'));
  }
}

function processDeleteOldDict(e) {
  const button = e.target;
  const btnId = button.id;
  if (!btnId.startsWith('delDict')) return;
  const btnNo = parseInt(btnId.split('_')[1], 10);
  wdOnlineDicts.splice(btnNo, 1);
  browser.storage.local.set({ wdOnlineDicts });
  initContextMenus(wdOnlineDicts);
  showUserDicts();
}

function processAddDict() {
  let dictName = document.getElementById('add-dict-name').value;
  let dictUrl = document.getElementById('add-dict-url').value;
  dictName = dictName.trim();
  dictUrl = dictUrl.trim();
  if (!dictName || !dictUrl) return;
  wdOnlineDicts.push({ title: dictName, url: dictUrl });
  browser.storage.local.set({ wdOnlineDicts });
  initContextMenus(wdOnlineDicts);
  showUserDicts();
  document.getElementById('add-dict-name').value = '';
  document.getElementById('add-dict-url').value = '';
}

function processTestNewDict() {
  let dictUrl = document.getElementById('add-dict-url').value;
  dictUrl = dictUrl.trim();
  if (!dictUrl) return;
  const url = `${dictUrl}test`;
  browser.tabs.create({ url });
}

function showInternalState() {
  const wordHlParams = wdHlSettings.wordParams;
  // var idiom_hl_params = wdHlSettings.idiomParams;

  document.getElementById('words-enabled').checked = wordHlParams.enabled;
  // document.getElementById("idiomsEnabled").checked = idiom_hl_params.enabled;
  document.getElementById('words-block').style.display = wordHlParams.enabled ? 'block' : 'none';
  // document.getElementById("idiomsBlock").style.display =
  // idiom_hl_params.enabled ? "block" : "none";

  document.getElementById('words-bold').checked = wordHlParams.bold;
  // document.getElementById("idiomsBold").checked = idiom_hl_params.bold;

  document.getElementById('words-background').checked = wordHlParams.useBackground;
  // document.getElementById("idiomsBackground").checked = idiom_hl_params.useBackground;

  document.getElementById('words-color').checked = wordHlParams.useColor;
  // document.getElementById("idiomsColor").checked = idiom_hl_params.useColor;

  document.getElementById('pronunciation-enabled').checked = wdEnableTTS;

  document.getElementById('wc-radio-block').style.display = wordHlParams.useColor
    ? 'block'
    : 'none';
  showRbStates(wcRbIds, wordHlParams.color);
  // document.getElementById("icRadioBlock").style.display
  //  = idiom_hl_params.useColor ? "block" : "none";
  // show_rb_states(ic_rb_ids, idiom_hl_params.color);
  document.getElementById('wb-radio-block').style.display = wordHlParams.useBackground
    ? 'block'
    : 'none';
  showRbStates(wbRbIds, wordHlParams.backgroundColor);
  // document.getElementById("ibRadioBlock").style.display
  // = idiom_hl_params.useBackground ? "block" : "none";
  // show_rb_states(ib_rb_ids, idiom_hl_params.backgroundColor);

  for (let t = 0; t < targetTypes.length; t += 1) {
    const ttype = targetTypes[t];
    for (let i = 0; i < hoverPopupTypes.length; i += 1) {
      const isHit = hoverPopupTypes[i] === wdHoverSettings[`${ttype}_hover`];
      document.getElementById(`${ttype}b-${hoverPopupTypes[i]}`).checked = isHit;
    }
  }

  highlightExampleText(wordHlParams, 'word-hl-text', 'wql', 'wqr');
  // highlight_example_text(idiom_hl_params, "idiomHlText", "iql", "iqr");
  showUserDicts();
}

/* eslint-disable no-param-reassign */
function addCbEventListener(id, dstParams, dstKey) {
  document.getElementById(id).addEventListener('click', () => {
    const checkboxElem = document.getElementById(id);
    if (checkboxElem.checked) {
      dstParams[dstKey] = true;
    } else {
      dstParams[dstKey] = false;
    }
    showInternalState();
  });
}

function processRb(dstParams, dstKey, ids) {
  for (let i = 0; i < ids.length; i += 1) {
    const docElement = document.getElementById(ids[i]);
    if (docElement.checked) {
      dstParams[dstKey] = docElement.label.style.backgroundColor;
    }
  }
  showInternalState();
}
/* eslint-enable no-param-reassign */

function handleRbLoop(ids, dstParams, dstKey) {
  for (let i = 0; i < ids.length; i += 1) {
    document.getElementById(ids[i]).addEventListener('click', () => {
      processRb(dstParams, dstKey, ids);
    });
  }
}

function assignBackLabels() {
  const labels = document.getElementsByTagName('LABEL');
  for (let i = 0; i < labels.length; i += 1) {
    if (labels[i].htmlFor !== '') {
      const elem = document.getElementById(labels[i].htmlFor);
      if (elem) elem.label = labels[i];
    }
  }
}

function hoverRbHandler() {
  for (let t = 0; t < targetTypes.length; t += 1) {
    const ttype = targetTypes[t];
    for (let i = 0; i < hoverPopupTypes.length; i += 1) {
      const elementId = `${ttype}b-${hoverPopupTypes[i]}`;
      const paramKey = `${ttype}_hover`;
      const rbElem = document.getElementById(elementId);
      if (rbElem.checked) {
        wdHoverSettings[paramKey] = hoverPopupTypes[i];
      }
    }
  }
  browser.storage.local.set({ wdHoverSettings });
}

function addHoverRbListeners() {
  for (let t = 0; t < targetTypes.length; t += 1) {
    for (let i = 0; i < hoverPopupTypes.length; i += 1) {
      const elementId = `${targetTypes[t]}b-${hoverPopupTypes[i]}`;
      document.getElementById(elementId).addEventListener('click', hoverRbHandler);
    }
  }
}

function processDisplay() {
  window.onload = () => {
    browser.storage.local
      .get(['wdHlSettings', 'wdHoverSettings', 'wdOnlineDicts', 'wdDeveloperMode', 'wdEnableTTS'])
      .then((result) => {
        assignBackLabels();
        wdHlSettings = result.wdHlSettings;
        wdHoverSettings = result.wdHoverSettings;
        wdOnlineDicts = result.wdOnlineDicts;
        wdEnableTTS = result.wdEnableTTS || false;

        const { wdDeveloperMode } = result;

        // TODO fix this monstrosity using this wrapper-function hack:
        // http://stackoverflow.com/questions/7053965/when-using-callbacks-inside-a-loop-in-javascript-is-there-any-way-to-save-a-var
        handleRbLoop(wcRbIds, wdHlSettings.wordParams, 'color');
        // handle_rb_loop(ic_rb_ids, wdHlSettings.idiomParams, "color");
        handleRbLoop(wbRbIds, wdHlSettings.wordParams, 'backgroundColor');
        // handle_rb_loop(ib_rb_ids, wdHlSettings.idiomParams, "backgroundColor");

        addCbEventListener('words-enabled', wdHlSettings.wordParams, 'enabled');
        // add_cb_event_listener("idiomsEnabled", wdHlSettings.idiomParams, "enabled");
        addCbEventListener('words-bold', wdHlSettings.wordParams, 'bold');
        // add_cb_event_listener("idiomsBold", wdHlSettings.idiomParams, "bold");
        addCbEventListener('words-background', wdHlSettings.wordParams, 'useBackground');
        // add_cb_event_listener("idiomsBackground", wdHlSettings.idiomParams, "useBackground");
        addCbEventListener('words-color', wdHlSettings.wordParams, 'useColor');
        // add_cb_event_listener("idiomsColor", wdHlSettings.idiomParams, "useColor");

        addHoverRbListeners();

        if (wdDeveloperMode) {
          document.getElementById('debug-control').style.display = 'block';
        }

        document
          .getElementById('gd-sync-button')
          .addEventListener('click', requestPermissionsAndSync);
        document
          .getElementById('gd-stop-sync-button')
          .addEventListener('click', stopSynchronization);

        document.getElementById('save-vocab').addEventListener('click', processExport);
        document.getElementById('load-vocab').addEventListener('click', processImport);

        document.getElementById('get-from-storage-btn').addEventListener('click', processGetDbg);
        document.getElementById('set-to-storage-btn').addEventListener('click', processSetDbg);

        document
          .getElementById('test-manifest-warnings-btn')
          .addEventListener('click', processTestWarnings);

        document.getElementById('add-dict').addEventListener('click', processAddDict);
        document.getElementById('test-new-dict').addEventListener('click', processTestNewDict);

        document.getElementById('more-info-iink').href = browser.extension.getURL(
          '../html/sync_help.html',
        );

        document.getElementById('save-visuals').addEventListener('click', () => {
          browser.storage.local.set({ wdHlSettings });
        });

        document.getElementById('default-dicts').addEventListener('click', () => {
          wdOnlineDicts = makeDefaultOnlineDicts();
          browser.storage.local.set({ wdOnlineDicts });
          initContextMenus(wdOnlineDicts);
          showUserDicts();
        });

        document.getElementById('pronunciation-enabled').addEventListener('click', (e) => {
          wdEnableTTS = e.target.checked;
          browser.storage.local.set({ wdEnableTTS });
        });

        displaySyncInterface();
        showInternalState();
      });
  };
}

document.addEventListener('DOMContentLoaded', () => {
  localizeHtmlPage();
  processDisplay();
});
