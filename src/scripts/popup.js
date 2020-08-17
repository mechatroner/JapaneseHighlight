import { request_unhighlight, add_lexeme, localizeHtmlPage } from './lib/common_lib'

// var dict_size = null;
var enabled_mode = true;

function display_mode() {
    chrome.tabs.getSelected(null, tab => {
        var url = new URL(tab.url);
        var domain = url.hostname;
        document.getElementById("addHostName").textContent = domain;
        if (enabled_mode) {
            document.getElementById("modeHeader").textContent = chrome.i18n.getMessage("enabledDescription");
            document.getElementById("addToListLabel").textContent = chrome.i18n.getMessage("addSkippedLabel");
            document.getElementById("addToListLabel").href = chrome.extension.getURL('../html/black_list.html');
            chrome.storage.local.get(["jhBlackList",], result => {
                var black_list = result.jhBlackList;
                document.getElementById("addToList").checked = Object.prototype.hasOwnProperty.call(black_list, domain);
            });
        } else {
            document.getElementById("modeHeader").textContent = chrome.i18n.getMessage("disabledDescription");
            document.getElementById("addToListLabel").textContent = chrome.i18n.getMessage("addFavoritesLabel");
            document.getElementById("addToListLabel").href = chrome.extension.getURL('../html/white_list.html');
            chrome.storage.local.get(["jhWhiteList",], result => {
                var white_list = result.jhWhiteList;
                document.getElementById("addToList").checked = Object.prototype.hasOwnProperty.call(white_list, domain);
            });
        }
    });
}

function process_checkbox() {
    const checkboxElem = document.getElementById("addToList");
    chrome.tabs.getSelected(null, tab => {
        var url = new URL(tab.url);
        var domain = url.hostname;
        document.getElementById("addHostName").textContent = domain;
        var list_name = enabled_mode ? "jhBlackList" : "jhWhiteList";
        chrome.storage.local.get([list_name], result => {
            var site_list = result[list_name];
            if (checkboxElem.checked) {
                site_list[domain] = 1;
            } else {
                delete site_list[domain];
            }
            chrome.storage.local.set({ [list_name]: site_list }, () => {
                display_mode();
            });
        });
    });
}


function process_mode_switch() {
    enabled_mode = !enabled_mode;
    chrome.storage.local.set({ "jhIsEnabled": enabled_mode });
    display_mode();
}

function process_show() {
    chrome.tabs.create({ 'url': chrome.extension.getURL('../html/display.html') });
}

function process_help() {
    chrome.tabs.create({ 'url': chrome.extension.getURL('../html/help.html') });
}

function process_adjust() {
    chrome.tabs.create({ 'url': chrome.extension.getURL('../html/options.html') });
}

function display_vocabulary_size() {
    chrome.storage.local.get(['jhUserVocabulary'], result => {
        var jhUserVocabulary = result.jhUserVocabulary;
        var vocab_size = Object.keys(jhUserVocabulary).length;
        document.getElementById("vocabIndicator").textContent = vocab_size;
    });
}


function popup_handle_add_result(report, lemma) {
    if (report === "ok") {
        request_unhighlight(lemma);
        display_vocabulary_size();
        document.getElementById('addText').value = "";
        document.getElementById('addOpResult').textContent = chrome.i18n.getMessage("addSuccess");
    } else if (report === "exists") {
        document.getElementById('addOpResult').textContent = chrome.i18n.getMessage("addErrorDupp");
    } else {
        document.getElementById('addOpResult').textContent = chrome.i18n.getMessage("addErrorBad");
    }
}

function process_add_word() {
    const lexeme = document.getElementById('addText').value;
    if (lexeme === 'dev-mode-on') {
        chrome.storage.local.set({ "wd_developer_mode": true });
        document.getElementById('addText').value = "";
        return;
    }
    if (lexeme === 'dev-mode-off') {
        chrome.storage.local.set({ "wd_developer_mode": false });
        document.getElementById('addText').value = "";
        return;
    }
    add_lexeme(lexeme, popup_handle_add_result);
}

function process_rate(increase) {
    chrome.storage.local.get(['jhMinimunRank'], result => {
        let minimunRank = result.jhMinimunRank + increase;
        // minimunRank += increase;
        // minimunRank = Math.min(100, Math.max(0, show_percents));
        // display_percents(minimunRank);
        document.getElementById("countIndicator").textContent = minimunRank;
        chrome.storage.local.set({ "jhMinimunRank": minimunRank });
    });
}

function process_rate_m100() {
    process_rate(-100);
}
function process_rate_m1000() {
    process_rate(-1000);
}
function process_rate_p100() {
    process_rate(100);
}
function process_rate_p1000() {
    process_rate(1000);
}

// function display_percents(show_percents) {
//     var not_showing_cnt = Math.floor((dict_size / 100.0) * show_percents);
//     document.getElementById("rateIndicator1").textContent = show_percents + "%";
//     document.getElementById("rateIndicator2").textContent = show_percents + "%";
//     document.getElementById("countIndicator").textContent = not_showing_cnt;
// }

function init_controls() {
    window.onload = () => {
        document.getElementById("addToList").addEventListener("click", process_checkbox);
        document.getElementById("adjust").addEventListener("click", process_adjust);
        document.getElementById("showVocab").addEventListener("click", process_show);
        document.getElementById("getHelp").addEventListener("click", process_help);
        document.getElementById("addWord").addEventListener("click", process_add_word);
        document.getElementById("rankM1000").addEventListener("click", process_rate_m1000);
        document.getElementById("rankM100").addEventListener("click", process_rate_m100);
        document.getElementById("rankP100").addEventListener("click", process_rate_p100);
        document.getElementById("rankP1000").addEventListener("click", process_rate_p1000);
        document.getElementById("changeMode").addEventListener("click", process_mode_switch);

        document.getElementById("addText").addEventListener("keyup", event => {
            event.preventDefault();
            if (event.key == 'Enter') {
                process_add_word();
            }
        });

        display_vocabulary_size();

        chrome.storage.local.get(['jhMinimunRank', 'jhIsEnabled'], result => {
            // var show_percents = result.wd_show_percents;
            enabled_mode = result.jhIsEnabled;
            // dict_size = result.wd_word_max_rank;
            document.getElementById("countIndicator").textContent = result.jhMinimunRank;
            // display_percents(show_percents);
            display_mode();
        });
    }
}

document.addEventListener("DOMContentLoaded", () => {
    localizeHtmlPage();
    init_controls();
});
