export function request_unhighlight(lemma) {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        chrome.tabs.sendMessage(tabs[0].id, { wdm_unhighlight: lemma });
    });
}


export function make_id_suffix(text) {
    const before = btoa(text);
    return before.replace(/\+/g, '_').replace(/\//g, '-').replace(/=/g, '_')
    // return after;
}


export function sync_if_needed() {
    var req_keys = ['wd_last_sync', 'wd_gd_sync_enabled', 'wd_last_sync_error'];
    chrome.storage.local.get(req_keys, result => {
        var wd_last_sync = result.wd_last_sync;
        var wd_gd_sync_enabled = result.wd_gd_sync_enabled;
        var wd_last_sync_error = result.wd_last_sync_error;
        if (!wd_gd_sync_enabled || wd_last_sync_error != null) {
            return;
        }
        var cur_date = new Date();
        var mins_passed = (cur_date.getTime() - wd_last_sync) / (60 * 1000);
        var sync_period_mins = 30;
        if (mins_passed >= sync_period_mins) {
            chrome.runtime.sendMessage({ wdm_request: "gd_sync", interactive_mode: false });
        }
    });
}


export function add_lexeme(lexeme, result_handler) {
    var req_keys = ['words_discoverer_eng_dict', 'wd_idioms', 'wd_user_vocabulary', 'wd_user_vocab_added', 'wd_user_vocab_deleted'];
    chrome.storage.local.get(req_keys, result => {
        var dict_words = result.words_discoverer_eng_dict;
        var dict_idioms = result.wd_idioms;
        var user_vocabulary = result.wd_user_vocabulary;
        var wd_user_vocab_added = result.wd_user_vocab_added;
        var wd_user_vocab_deleted = result.wd_user_vocab_deleted;
        if (lexeme.length > 100) {
            result_handler("bad", undefined);
            return;
        }
        lexeme = lexeme.toLowerCase();
        lexeme = lexeme.trim();
        if (!lexeme) {
            result_handler("bad", undefined);
            return;
        }

        var key = lexeme;
        if (Object.prototype.hasOwnProperty.call(dict_words, lexeme)) {
            const wf = dict_words[lexeme];
            if (wf) {
                key = wf[0];
            }
        } else if (Object.prototype.hasOwnProperty.call(dict_idioms, lexeme)) {
            const wf = dict_idioms[lexeme];
            if (wf && wf != -1) {
                key = wf;
            }
        }

        if (Object.prototype.hasOwnProperty.call(user_vocabulary, key)) {
            result_handler("exists", key);
            return;
        }

        var new_state = { 'wd_user_vocabulary': user_vocabulary };

        user_vocabulary[key] = 1;
        if (typeof wd_user_vocab_added !== 'undefined') {
            wd_user_vocab_added[key] = 1;
            new_state['wd_user_vocab_added'] = wd_user_vocab_added;
        }
        if (typeof wd_user_vocab_deleted !== 'undefined') {
            delete wd_user_vocab_deleted[key];
            new_state['wd_user_vocab_deleted'] = wd_user_vocab_deleted;
        }

        chrome.storage.local.set(new_state, () => {
            sync_if_needed();
            result_handler("ok", key);
        });
    });
}


export function make_hl_style(hl_params) {
    if (!hl_params.enabled)
        return undefined;
    let result = "";
    if (hl_params.bold)
        result += "font-weight:bold;";
    if (hl_params.useBackground)
        result += "background-color:" + hl_params.backgroundColor + ";";
    if (hl_params.useColor)
        result += "color:" + hl_params.color + ";";
    if (!result)
        return undefined;
    result += "font-size:inherit;display:inline;";
    return result;
}


export function localizeHtmlPage() {
    //Localize by replacing __MSG_***__ meta tags
    var objects = document.getElementsByTagName('html');
    for (var j = 0; j < objects.length; j++) {
        var obj = objects[j];
        var valStrH = obj.innerHTML.toString();
        var valNewH = valStrH.replace(/__MSG_(\w+)__/g, (match, v1) => {
            return v1 ? chrome.i18n.getMessage(v1) : "";
        });
        if (valNewH != valStrH) {
            obj.innerHTML = valNewH;
        }
    }
}


export function spformat(src) {
    var args = Array.prototype.slice.call(arguments, 1);
    return src.replace(/{(\d+)}/g, (match, number) => {
        return typeof args[number] != 'undefined' ? args[number] : match;
    });
}
