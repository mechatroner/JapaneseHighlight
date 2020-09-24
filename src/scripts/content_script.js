import browser from 'webextension-polyfill';
import { makeHlStyle, addLexeme, readFile, processData } from './lib/common_lib';
import { getDictDefinitionUrl } from './lib/context_menu_lib';

const classNamePrefix = 'wdautohlja_';
const JapaneseRegex = /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf]/;
let JaDict = null;

let wdMinimunRank = 1;
let wordMaxRank = 0;
let userVocabulary = [];
// let is_enabled = null;
let wdHlSettings = null;
let wdHoverSettings = null;
let wdOnlineDicts = null;
let wdEnableTTS = null;

// let disableByKeypress = false;

let currentLexeme = '';
// use to find node to render popup
let curWdNodeId = 1;

let functionKeyIsPressed = false;
let renderedNodeId = null;
let nodeToRenderId = null;

// function make_class_name(lemma) {
//     if (lemma) {
//         return 'wdautohlja_' + lemma;
//     }
//     return 'wdautohlja_none_none';
// }

function limitTextLen(word) {
  if (!word) return word;
  // word = word.toLowerCase();
  const maxLen = 20;
  if (word.length <= maxLen) return word;
  return `${word.slice(0, maxLen)}...`;
}

function getHeatColorPoint(freqPercentOld) {
  let freqPercent = freqPercentOld;
  if (!freqPercent) freqPercent = 0;
  freqPercent = Math.max(0, Math.min(100, freqPercent));
  const hue = 100 - freqPercent;
  return `hsl(${hue}, 100%, 50%)`;
}

function assert(condition, message) {
  if (!condition) {
    throw message || 'Assertion failed';
  }
}

const goodTagsList = [
  'P',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'B',
  'SMALL',
  'STRONG',
  'Q',
  'DIV',
  'SPAN',
];

const mygoodfilter = (node) => {
  if (goodTagsList.indexOf(node.parentNode.tagName) !== -1) return NodeFilter.FILTER_ACCEPT;
  return NodeFilter.FILTER_SKIP;
};

async function textToHlNodes(text, newChildren) {
  // return new Promise((resolve) => {
  const response = await browser.runtime.sendMessage({ text });
  if (!response) return 0;
  const tokenizeOther = wdHoverSettings.ow_hover !== 'never';
  let ibegin = 0; // beginning of word
  const matches = [];
  const lines = response.split('\n');

  // length - 2 because last 2 lines always are "EOS" ""
  for (let i = 0; i < lines.length - 2; i += 1) {
    const textArr = lines[i].split('\t');
    const originalWord = textArr[0];
    if (originalWord.match(JapaneseRegex)) {
      let lemma = textArr[3];
      if (lemma.includes('-')) {
        [, , lemma] = textArr;
      }
      let match;
      if (
        !match &&
        wdHlSettings.wordParams.enabled &&
        !Object.prototype.hasOwnProperty.call(userVocabulary, lemma)
      ) {
        const wordFound = JaDict.find((obj) => obj.lemma === lemma);
        if (wordFound && wordFound.rank >= wdMinimunRank) {
          match = {
            normalized: lemma,
            kind: 'lemma',
            begin: ibegin,
            end: ibegin + originalWord.length,
            rank: wordFound.rank,
            frequency: wordFound.frequency,
          };
        }
      }
      if (tokenizeOther && !match) {
        match = {
          normalized: null,
          kind: 'word',
          begin: ibegin,
          end: ibegin + originalWord.length,
        };
      }
      if (match) {
        matches.push(match);
      }
      ibegin += originalWord.length;
    } else {
      ibegin += originalWord.length;
    }
  }

  let lastHlEndPos = 0;
  let insertCount = 0;
  // for (const match of matches) {
  matches.forEach((match) => {
    insertCount += 1;
    let textStyle;
    let className;
    if (match.kind === 'lemma') {
      const hlParams = wdHlSettings.wordParams;
      textStyle = makeHlStyle(hlParams);
      className = `${match.normalized}_${match.rank}:${match.frequency}`;
    } else if (match.kind === 'word') {
      textStyle = 'font:inherit;display:inline;color:inherit;background-color:inherit;';
      className = match.normalized;
    }
    if (lastHlEndPos < match.begin) {
      newChildren.push(document.createTextNode(text.slice(lastHlEndPos, match.begin)));
    }
    lastHlEndPos = match.end;
    // span = document.createElement("span");
    // const span = document.createElement('wdautohlja-customtag')
    const span = document.createElement('span');
    span.textContent = text.slice(match.begin, lastHlEndPos);
    span.setAttribute('style', textStyle);
    span.id = `wdautohlja_id${curWdNodeId}`;
    curWdNodeId += 1;
    const wdclassname = classNamePrefix + className;
    span.setAttribute('class', wdclassname);
    newChildren.push(span);
  });
  if (insertCount && lastHlEndPos < text.length) {
    newChildren.push(document.createTextNode(text.slice(lastHlEndPos, text.length)));
  }
  return insertCount;
}

function doHighlightText(textNodes) {
  if (textNodes === null || textNodes.length === 0 || JaDict === null || wdMinimunRank === null) {
    return;
  }
  // disableByKeypress

  textNodes.forEach((textNode) => {
    const { parentNode } = textNode;
    if (!parentNode) {
      return;
    }
    if (textNodes.offsetParent === null) {
      return;
    }
    const text = textNode.textContent;
    if (text.length <= 3) {
      return;
    }
    if (text.indexOf('{') !== -1 && text.indexOf('}') !== -1) {
      // continue; //pathetic hack to skip json data in text (e.g. google images use it).
      return;
    }
    if (!text.match(JapaneseRegex)) {
      return;
    }
    const newChildren = [];

    textToHlNodes(text, newChildren).then((insertCount) => {
      if (insertCount) {
        // num_found += found_count;
        assert(newChildren.length > 0, 'children must be non empty');
        for (let j = 0; j < newChildren.length; j += 1) {
          parentNode.insertBefore(newChildren[j], textNode);
        }
        parentNode.removeChild(textNode);
      }
    });
  });
}

function textNodesUnder(el) {
  const a = [];
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, mygoodfilter, false);
  let n = walk.nextNode();
  while (n) {
    a.push(n);
    n = walk.nextNode();
  }
  doHighlightText(a);
  // return a;
}

function onNodeInserted(event) {
  const inobj = event.target;
  if (!inobj) return;
  let classattr = null;
  if (typeof inobj.getAttribute !== 'function') {
    return;
  }
  try {
    classattr = inobj.getAttribute('class');
  } catch (e) {
    return;
  }
  if (!classattr || !classattr.startsWith('wdautohlja_')) {
    textNodesUnder(inobj);
    // const textNodes = textNodesUnder(inobj);
    // doHighlightText(textNodes);
  }
}

function unhighlight(lemma) {
  const hlNodes = document.querySelectorAll(`[class^=${classNamePrefix}${lemma}]`);
  // for (const hlNode of hlNodes) {
  hlNodes.forEach((hlNode) => {
    hlNode.setAttribute(
      'style',
      'font-weight:inherit;color:inherit;font-size:inherit;background-color:inherit;display:inline;',
    );
    hlNode.setAttribute('class', 'wdautohlja_none_none');
  });
}

function bubbleHandleTts(lexeme) {
  browser.runtime.sendMessage({ type: 'tts_speak', word: lexeme });
}

function bubbleHandleAddResult(report, lemma) {
  if (report === 'ok' || report === 'exists') {
    unhighlight(lemma);
  }
}

function hideBubble(force) {
  const bubbleDOM = document.getElementById('wd-selection-bubble-ja');
  if (force || (!bubbleDOM.wdMouseOn && nodeToRenderId !== renderedNodeId)) {
    bubbleDOM.style.display = 'none';
    renderedNodeId = null;
  }
}

function searchDict(e) {
  const dictUrl = e.target.getAttribute('wdDictRefUrl');
  const newTabUrl = getDictDefinitionUrl(dictUrl, currentLexeme);
  browser.runtime.sendMessage({ wdmNewTabUrl: newTabUrl });
}

function createBubble() {
  const bubbleDOM = document.createElement('div');
  // bubbleDOM.setAttribute('class', 'wd-selection-bubble-ja');
  bubbleDOM.setAttribute('id', 'wd-selection-bubble-ja');

  const infoSpan = document.createElement('span');
  infoSpan.setAttribute('id', 'wd-selection-bubble-text-ja');
  // infoSpan.setAttribute('class', 'wd-infoSpanJA');
  bubbleDOM.appendChild(infoSpan);

  const freqSpan = document.createElement('span');
  freqSpan.setAttribute('id', 'wd-selection-bubble-freq-ja');
  // freqSpan.setAttribute('class', 'wdFreqSpanJA');
  freqSpan.textContent = 'n/a';
  bubbleDOM.appendChild(freqSpan);

  const addButton = document.createElement('button');
  addButton.setAttribute('class', 'wd-add-button-ja');
  addButton.textContent = browser.i18n.getMessage('menuItem');
  addButton.style.marginBottom = '4px';
  addButton.addEventListener('click', () => {
    addLexeme(currentLexeme, bubbleHandleAddResult);
  });
  bubbleDOM.appendChild(addButton);

  const speakButton = document.createElement('button');
  speakButton.setAttribute('class', 'wd-add-button-ja');
  speakButton.textContent = 'Audio';
  speakButton.style.marginBottom = '4px';
  speakButton.addEventListener('click', () => {
    bubbleHandleTts(currentLexeme);
  });
  bubbleDOM.appendChild(speakButton);

  // dictPairs = makeDictionaryPairs();
  const dictPairs = wdOnlineDicts;
  for (let i = 0; i < dictPairs.length; i += 1) {
    const dictButton = document.createElement('button');
    dictButton.setAttribute('class', 'wd-add-button-ja');
    dictButton.textContent = dictPairs[i].title;
    dictButton.setAttribute('wdDictRefUrl', dictPairs[i].url);
    dictButton.addEventListener('click', searchDict);
    bubbleDOM.appendChild(dictButton);
  }

  bubbleDOM.addEventListener('mouseleave', () => {
    bubbleDOM.wdMouseOn = false;
    hideBubble(false);
  });
  bubbleDOM.addEventListener('mouseenter', () => {
    bubbleDOM.wdMouseOn = true;
  });

  return bubbleDOM;
}

function renderBubble() {
  if (!nodeToRenderId) return;
  if (nodeToRenderId === renderedNodeId) return;

  const nodeToRender = document.getElementById(nodeToRenderId);
  if (!nodeToRender) return;

  const classattr = nodeToRender.getAttribute('class');
  const isHighlighted = classattr !== 'wdautohlja_none_none';
  const paramKey = isHighlighted ? 'hl_hover' : 'ow_hover';
  const paramValue = wdHoverSettings[paramKey];
  if (paramValue === 'never' || (paramValue === 'key' && !functionKeyIsPressed)) {
    return;
  }

  const bubbleDOM = document.getElementById('wd-selection-bubble-ja');
  const bubbleText = document.getElementById('wd-selection-bubble-text-ja');
  const bubbleFreq = document.getElementById('wd-selection-bubble-freq-ja');
  [, currentLexeme, bubbleFreq.textContent] = classattr.split('_');
  bubbleText.textContent = limitTextLen(currentLexeme);
  const [rank] = bubbleFreq.textContent.split(':');
  bubbleFreq.style.backgroundColor = getHeatColorPoint((rank / wordMaxRank) * 100);
  const bcr = nodeToRender.getBoundingClientRect();
  bubbleDOM.style.top = `${bcr.bottom}px`;
  bubbleDOM.style.left = `${Math.max(5, Math.floor((bcr.left + bcr.right) / 2) - 100)}px`;
  bubbleDOM.style.display = 'block';
  renderedNodeId = nodeToRenderId;

  if (wdEnableTTS) {
    browser.runtime.sendMessage({ type: 'tts_speak', word: currentLexeme });
  }
}

function processHlLeave() {
  nodeToRenderId = null;
  setTimeout(() => {
    hideBubble(false);
  }, 100);
}

function processMouse(e) {
  const hitNode = document.elementFromPoint(e.clientX, e.clientY);
  if (!hitNode) {
    processHlLeave();
    return;
  }
  let classattr = null;
  try {
    classattr = hitNode.getAttribute('class');
  } catch (exc) {
    processHlLeave();
    return;
  }
  if (!classattr || !classattr.startsWith('wdautohlja_')) {
    processHlLeave();
    return;
  }
  nodeToRenderId = hitNode.id;
  setTimeout(() => {
    renderBubble();
  }, 200);
}

function getVerdict(isEnabled, wdBlackList, wdWhiteList, hostname) {
  if (Object.prototype.hasOwnProperty.call(wdBlackList, hostname)) {
    return 'site in "Skip List"';
  }
  if (Object.prototype.hasOwnProperty.call(wdWhiteList, hostname)) {
    return 'highlight';
  }
  return isEnabled ? 'highlight' : 'site is not in "Favorites List"';
}

function initForPage() {
  if (!document.body) return;

  browser.storage.local
    .get([
      'wdOnlineDicts',
      'wdHoverSettings',
      'wdIsEnabled',
      'wdUserVocabulary',
      'wdHlSettings',
      'wdBlackList',
      'wdWhiteList',
      'wdEnableTTS',
      'wdMinimunRank',
    ])
    .then((result) => {
      // JaDict = result.jhJpnDict
      const { wdIsEnabled, wdBlackList, wdWhiteList } = result;
      // const { wdBlackList } = result;
      // const { wdWhiteList } = result;

      const { hostname } = window.location;
      // window.location document.URL document.location.href
      const verdict = getVerdict(wdIsEnabled, wdBlackList, wdWhiteList, hostname);
      // to change icon
      browser.runtime.sendMessage({ wdmVerdict: verdict });
      if (verdict !== 'highlight') return;

      const bccwj = browser.runtime.getURL('../data/mybccwj.csv');
      readFile(bccwj).then((text) => {
        JaDict = processData(text);
        wordMaxRank = JaDict.length - 1;
        textNodesUnder(document.body);
        document.addEventListener('DOMNodeInserted', onNodeInserted, false);
      });

      wdOnlineDicts = result.wdOnlineDicts;
      wdEnableTTS = result.wdEnableTTS;
      userVocabulary = result.wdUserVocabulary;
      wdHoverSettings = result.wdHoverSettings;
      wdHlSettings = result.wdHlSettings;
      wdMinimunRank = result.wdMinimunRank;
      // dict_words = result.words_discoverer_eng_dict;
      // dict_idioms = result.wd_idioms;
      // const show_percents = result.wd_show_percents;

      browser.runtime.onMessage.addListener((request) => {
        if (request.wdmUnhighlight) {
          const lemma = request.wdmUnhighlight;
          unhighlight(lemma);
        }
      });

      document.addEventListener('keydown', (event) => {
        if (event.key === 'Control') {
          functionKeyIsPressed = true;
          renderBubble();
          // return;
        }
        // var elementTagName = event.target.tagName;
        // if (!disable_by_keypress && elementTagName != 'BODY') {
        //   // workaround to prevent highlighting in facebook messages
        //   // this logic can also be helpful in other situations,
        //   // it's better play safe and stop highlighting when user enters data.
        //   disable_by_keypress = true;
        //   chrome.runtime.sendMessage({ wdmVerdict: 'keyboard' });
        // }
      });

      document.addEventListener('keyup', (event) => {
        if (event.key === 'Control') {
          functionKeyIsPressed = false;
        }
      });

      const bubbleDOM = createBubble();
      document.body.appendChild(bubbleDOM);
      // document.addEventListener('mousedown', hideBubble(true), false);
      document.addEventListener('mousemove', processMouse, false);
      window.addEventListener('scroll', () => {
        nodeToRenderId = null;
        hideBubble(true);
      });
      // });
    });
}

document.addEventListener('DOMContentLoaded', () => {
  initForPage();
});
