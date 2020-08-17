// import browser from 'webextension-polyfill'
import PQueue from 'p-queue'
import { make_hl_style, add_lexeme, readFile, processData } from './lib/common_lib'
import { get_dict_definition_url } from './lib/context_menu_lib'
import workerFunction from './lib/mecab_worker'

let mecabWorker = new SharedWorker(URL.createObjectURL(new Blob(["(" + workerFunction.toString() + ")()"], { type: 'text/javascript' })));
const mecabQueue = new PQueue({ concurrency: 1 });

const classNamePrefix = 'wdautohlja_'
const JapaneseRegex = /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf]/
let JaDict = null;

let jhMinimunRank = 1;
let word_max_rank = 0;
let user_vocabulary = [];
let is_enabled = null;
let jhHlSettings = null;
let jhHoverSettings = null;
let jhOnlineDicts = null;
let jhEnableTTS = null;

let disable_by_keypress = false;

let current_lexeme = "";
let cur_wd_node_id = 1;

let function_key_is_pressed = false;
let rendered_node_id = null;
let node_to_render_id = null;

// function make_class_name(lemma) {
//     if (lemma) {
//         return 'wdautohlja_' + lemma;
//     }
//     return 'wdautohlja_none_none';
// }

function limit_text_len(word) {
    if (!word)
        return word;
    word = word.toLowerCase();
    var max_len = 20;
    if (word.length <= max_len)
        return word;
    return word.slice(0, max_len) + "...";
}

function getHeatColorPoint(freqPercent) {
    if (!freqPercent)
        freqPercent = 0;
    freqPercent = Math.max(0, Math.min(100, freqPercent));
    var hue = 100 - freqPercent;
    return "hsl(" + hue + ", 100%, 50%)";
}

function assert(condition, message) {
    if (!condition) {
        throw message || "Assertion failed";
    }
}

const good_tags_list = ["P", "H1", "H2", "H3", "H4", "H5", "H6", "B", "SMALL", "STRONG", "Q", "DIV", "SPAN"];

const mygoodfilter = (node) => {
    if (good_tags_list.indexOf(node.parentNode.tagName) !== -1)
        return NodeFilter.FILTER_ACCEPT;
    return NodeFilter.FILTER_SKIP;
}

function textNodesUnder(el) {
    var n, a = [], walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, mygoodfilter, false);
    n = walk.nextNode()
    while (n) {
        a.push(n);
        n = walk.nextNode()
    }
    doHighlightText(a)
    // return a;
}

function text_to_hl_nodes(text, new_children) {
    return new Promise(resolve => {
        // const text = textNode.textContent
        // console.log('1', text)
        mecabWorker.port.postMessage({ text })
        mecabWorker.onerror = (e) => {
            console.error(e)
        }
        mecabWorker.port.onmessageerror = (e) => {
            console.error(e)
        }
        mecabWorker.port.onmessage = (e) => {
            // && e.data.timestamp === timestamp
            // if (e.data.message === 'postTokenize') {
            const tokenize_other = jhHoverSettings.ow_hover != 'never';
            let ibegin = 0; //beginning of word
            const matches = [];
            const lines = e.data.output.split('\n');

            // length - 2 because last 2 lines always are "EOS" ""
            for (let i = 0; i < lines.length - 2; ++i) {
                const textArr = lines[i].split('\t')
                const originalWord = textArr[0]
                if (!originalWord.match(JapaneseRegex)) {
                    ibegin += originalWord.length;
                    continue
                }
                let lemma = textArr[3]
                if (lemma.includes('-')) {
                    lemma = textArr[2]
                }
                let match = undefined;
                if (!match && jhHlSettings.wordParams.enabled && !Object.prototype.hasOwnProperty.call(user_vocabulary, lemma)) {
                    const wordFound = JaDict.find(obj => (obj.lemma === lemma))
                    if (wordFound && wordFound.rank >= jhMinimunRank) {
                        match = { normalized: lemma, kind: "lemma", begin: ibegin, end: ibegin + originalWord.length, rank: wordFound.rank, frequency: wordFound.frequency };
                    }
                }
                if (tokenize_other && !match) {
                    match = { normalized: null, kind: "word", begin: ibegin, end: ibegin + originalWord.length };
                }
                if (match) {
                    matches.push(match)
                }
                ibegin += originalWord.length;
            }

            let last_hl_end_pos = 0;
            let insert_count = 0;
            for (const match of matches) {
                insert_count += 1;
                let text_style = undefined;
                let className = undefined;
                if (match.kind === "lemma") {
                    const hlParams = jhHlSettings.wordParams;
                    text_style = make_hl_style(hlParams);
                    className = `${match.normalized}-${match.rank}:${match.frequency}`
                } else if (match.kind === "word") {
                    text_style = "font:inherit;display:inline;color:inherit;background-color:inherit;"
                    className = match.normalized
                }
                if (last_hl_end_pos < match.begin) {
                    // console.log(last_hl_end_pos, match.begin)
                    new_children.push(document.createTextNode(text.slice(last_hl_end_pos, match.begin)));
                }
                last_hl_end_pos = match.end;
                //span = document.createElement("span");
                const span = document.createElement("wdautohlja-customtag");
                span.textContent = text.slice(match.begin, last_hl_end_pos);
                span.setAttribute("style", text_style);
                span.id = 'wdautohlja_id' + cur_wd_node_id;
                cur_wd_node_id += 1;
                const wdclassname = classNamePrefix + className;
                span.setAttribute("class", wdclassname);
                new_children.push(span);
            }

            if (insert_count && last_hl_end_pos < text.length) {
                new_children.push(document.createTextNode(text.slice(last_hl_end_pos, text.length)));
            }
            // console.log(text, lines)
            resolve(insert_count)
        }
    })
}

async function doHighlightText(textNodes) {
    if (textNodes === null || textNodes.length === 0 || JaDict === null || jhMinimunRank === null) {
        return;
    }
    if (disable_by_keypress) {
        return;
    }

    for (const textNode of textNodes) {
        if (textNodes.offsetParent === null) {
            continue;
        }
        const text = textNode.textContent;
        if (text.length <= 3) {
            continue;
        }
        if (text.indexOf('{') !== -1 && text.indexOf('}') !== -1) {
            continue; //pathetic hack to skip json data in text (e.g. google images use it).
        }
        if (!text.match(JapaneseRegex)) {
            continue
        }
        const new_children = []

        // console.time('textToNodes')
        const insert_count = await mecabQueue.add(() => (text_to_hl_nodes(text, new_children)));
        // console.timeEnd('textToNodes')
        if (insert_count) {
            // num_found += found_count;
            const parent_node = textNode.parentNode;
            assert(new_children.length > 0, "children must be non empty");
            for (var j = 0; j < new_children.length; j++) {
                parent_node.insertBefore(new_children[j], textNode);
            }
            parent_node.removeChild(textNode);
        }
    }
}

function onNodeInserted(event) {
    const inobj = event.target;
    if (!inobj)
        return;
    let classattr = null;
    if (typeof inobj.getAttribute !== 'function') {
        return;
    }
    try {
        classattr = inobj.getAttribute('class');
    } catch (e) {
        return;
    }
    if (!classattr || !classattr.startsWith("wdautohlja_")) {
        textNodesUnder(inobj);
        // const textNodes = textNodesUnder(inobj);
        // doHighlightText(textNodes);
    }
}


function unhighlight(lemma) {
    const hlNodes = document.querySelectorAll(`[class^=${classNamePrefix}${lemma}]`)
    for (let hlNode of hlNodes) {
        hlNode.setAttribute("style", "font-weight:inherit;color:inherit;font-size:inherit;background-color:inherit;display:inline;");
        hlNode.setAttribute("class", "wdautohlja_none_none");
    }
}

function bubble_handle_tts(lexeme) {
    // chrome.tts.speak(lexeme, { lang: "ja" })
    chrome.runtime.sendMessage({ type: "tts_speak", word: lexeme });
}


function bubble_handle_add_result(report, lemma) {
    if (report === "ok" || report === "exists") {
        unhighlight(lemma);
    }
}

function create_bubble() {
    var bubbleDOM = document.createElement('div');
    bubbleDOM.setAttribute('class', 'wdSelectionBubbleJA');
    bubbleDOM.setAttribute("id", "wd_selection_bubbleJA")

    var infoSpan = document.createElement('span');
    infoSpan.setAttribute("id", "wd_selection_bubble_textJA")
    infoSpan.setAttribute('class', 'wdInfoSpanJA');
    bubbleDOM.appendChild(infoSpan);

    var freqSpan = document.createElement('span');
    freqSpan.setAttribute("id", "wd_selection_bubble_freqJA")
    freqSpan.setAttribute('class', 'wdFreqSpanJA');
    freqSpan.textContent = "n/a";
    bubbleDOM.appendChild(freqSpan);

    var addButton = document.createElement('button');
    addButton.setAttribute('class', 'wdAddButtonJA');
    addButton.textContent = chrome.i18n.getMessage("menuItem");
    addButton.style.marginBottom = "4px";
    addButton.addEventListener("click", () => {
        add_lexeme(current_lexeme, bubble_handle_add_result);
    });
    bubbleDOM.appendChild(addButton);

    var speakButton = document.createElement('button');
    speakButton.setAttribute('class', 'wdAddButtonJA');
    speakButton.textContent = 'Audio';
    speakButton.style.marginBottom = "4px";
    speakButton.addEventListener("click", () => {
        bubble_handle_tts(current_lexeme);
    });
    bubbleDOM.appendChild(speakButton);

    //dictPairs = makeDictionaryPairs();
    var dictPairs = jhOnlineDicts;
    for (var i = 0; i < dictPairs.length; ++i) {
        var dictButton = document.createElement('button');
        dictButton.setAttribute('class', 'wdAddButtonJA');
        dictButton.textContent = dictPairs[i].title;
        dictButton.setAttribute('wdDictRefUrl', dictPairs[i].url);
        dictButton.addEventListener("click", e => {
            const target = e.target;
            const dictUrl = target.getAttribute('wdDictRefUrl');
            var newTabUrl = get_dict_definition_url(dictUrl, current_lexeme);
            chrome.runtime.sendMessage({ wdm_new_tab_url: newTabUrl });
        });
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
    if (!node_to_render_id)
        return;
    if (node_to_render_id === rendered_node_id)
        return;

    const node_to_render = document.getElementById(node_to_render_id);
    if (!node_to_render)
        return;

    const classattr = node_to_render.getAttribute('class');
    const is_highlighted = (classattr != "wdautohlja_none_none");
    const param_key = is_highlighted ? "hl_hover" : "ow_hover";
    const param_value = jhHoverSettings[param_key];
    if (param_value == "never" || (param_value == "key" && !function_key_is_pressed)) {
        return;
    }

    const wdSpanText = node_to_render.textContent;
    const bubbleDOM = document.getElementById("wd_selection_bubbleJA");
    const bubbleText = document.getElementById("wd_selection_bubble_textJA");
    const bubbleFreq = document.getElementById("wd_selection_bubble_freqJA");
    bubbleText.textContent = limit_text_len(wdSpanText);
    bubbleFreq.textContent = classattr.split('-')[1]
    const rank = classattr.substring(
        classattr.lastIndexOf("-") + 1,
        classattr.lastIndexOf(":")
    );
    bubbleFreq.style.backgroundColor = getHeatColorPoint(rank / word_max_rank * 100);
    current_lexeme = classattr.substring(
        classattr.lastIndexOf("_") + 1,
        classattr.lastIndexOf("-")
    );
    var bcr = node_to_render.getBoundingClientRect();
    bubbleDOM.style.top = bcr.bottom + 'px';
    bubbleDOM.style.left = Math.max(5, Math.floor((bcr.left + bcr.right) / 2) - 100) + 'px';
    bubbleDOM.style.display = 'block';
    rendered_node_id = node_to_render_id;

    if (jhEnableTTS) {
        chrome.runtime.sendMessage({ type: "tts_speak", word: wdSpanText });
    }
}

function hideBubble(force) {
    const bubbleDOM = document.getElementById("wd_selection_bubbleJA");
    if (force || (!bubbleDOM.wdMouseOn && (node_to_render_id != rendered_node_id))) {
        bubbleDOM.style.display = 'none';
        rendered_node_id = null;
    }
}

function process_hl_leave() {
    node_to_render_id = null;
    setTimeout(() => {
        hideBubble(false);
    }, 100);
}

function processMouse(e) {
    const hitNode = document.elementFromPoint(e.clientX, e.clientY);
    if (!hitNode) {
        process_hl_leave();
        return;
    }
    let classattr = null;
    try {
        classattr = hitNode.getAttribute('class');
    } catch (exc) {
        process_hl_leave();
        return;
    }
    if (!classattr || !classattr.startsWith("wdautohlja_")) {
        process_hl_leave();
        return;
    }
    node_to_render_id = hitNode.id;
    setTimeout(() => {
        renderBubble();
    }, 200);
}

function get_verdict(is_enabled, jhBlackList, jhWhiteList, hostname) {
    if (Object.prototype.hasOwnProperty.call(jhBlackList, hostname)) {
        return "site in \"Skip List\"";
    }
    if (Object.prototype.hasOwnProperty.call(jhWhiteList, hostname)) {
        return "highlight";
    }
    return is_enabled ? "highlight" : "site is not in \"Favorites List\"";
}

function initForPage() {
    if (!document.body)
        return;

    chrome.storage.local.get(['jhOnlineDicts', 'jhHoverSettings', 'jhIsEnabled', 'jhUserVocabulary', 'jhHlSettings', 'jhBlackList', 'jhWhiteList', 'jhEnableTTS', 'jhMinimunRank'], (result) => {
        // JaDict = result.jhJpnDict
        is_enabled = result.jhIsEnabled;
        const jhBlackList = result.jhBlackList;
        const jhWhiteList = result.jhWhiteList;

        const hostname = window.location.hostname;
        // console.log(window.location)
        // console.log(document.URL)
        // console.log(document.location.href)
        const verdict = get_verdict(is_enabled, jhBlackList, jhWhiteList, hostname);
        // to change icon
        chrome.runtime.sendMessage({ wdm_verdict: verdict });
        if (verdict !== "highlight")
            return;

        const bccwj = chrome.runtime.getURL("../data/mybccwj.csv");
        readFile(bccwj).then((text) => {
            JaDict = processData(text)
            word_max_rank = JaDict.length - 1

            textNodesUnder(document.body);
            // TODO: 
            document.addEventListener("DOMNodeInserted", onNodeInserted, false);
        })

        jhOnlineDicts = result.jhOnlineDicts;
        jhEnableTTS = result.jhEnableTTS;
        user_vocabulary = result.jhUserVocabulary;
        jhHoverSettings = result.jhHoverSettings;
        jhHlSettings = result.jhHlSettings;
        jhMinimunRank = result.jhMinimunRank
        // dict_words = result.words_discoverer_eng_dict;
        // dict_idioms = result.wd_idioms;
        // const show_percents = result.wd_show_percents;

        chrome.runtime.onMessage.addListener((request) => {
            if (request.wdm_unhighlight) {
                const lemma = request.wdm_unhighlight;
                unhighlight(lemma);
            }
        });

        document.addEventListener("keydown", event => {
            if (event.key == 'Control') {
                function_key_is_pressed = true;
                renderBubble();
                return;
            }
            // var elementTagName = event.target.tagName;
            // if (!disable_by_keypress && elementTagName != 'BODY') {
            //     //workaround to prevent highlighting in facebook messages
            //     //this logic can also be helpful in other situations, it's better play safe and stop highlighting when user enters data.
            //     disable_by_keypress = true;
            //     chrome.runtime.sendMessage({ wdm_verdict: "keyboard" });
            // }
        });

        document.addEventListener("keyup", event => {
            if (event.key == 'Control') {
                function_key_is_pressed = false;
                return;
            }
        });

        const bubbleDOM = create_bubble();
        document.body.appendChild(bubbleDOM);
        // document.addEventListener('mousedown', hideBubble(true), false);
        document.addEventListener('mousemove', processMouse, false);
        window.addEventListener('scroll', () => {
            node_to_render_id = null;
            hideBubble(true);
        });
        // });
    });
}

document.addEventListener("DOMContentLoaded", () => {
    initForPage();
});