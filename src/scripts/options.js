import { saveAs } from './lib/Filesaver'
import {
    make_hl_style,
    localizeHtmlPage
} from './lib/common_lib'
import { initContextMenus, make_default_online_dicts } from './lib/context_menu_lib'

var jhHlSettings = null;
var jhHoverSettings = null;
var jhOnlineDicts = null;
var jhEnableTTS = false;

var wc_rb_ids = ['wc1', 'wc2', 'wc3', 'wc4', 'wc5'];
// var ic_rb_ids = ['ic1', 'ic2', 'ic3', 'ic4', 'ic5'];
var wb_rb_ids = ['wb1', 'wb2', 'wb3', 'wb4', 'wb5'];
// var ib_rb_ids = ['ib1', 'ib2', 'ib3', 'ib4', 'ib5'];

var hover_popup_types = ['never', 'key', 'always'];
var target_types = ['hl', 'ow']


function display_sync_interface() {
    chrome.storage.local.get(["jhGdSyncEnabled", "jhLastSyncError", "jhLastSync"], result => {
        const jhLastSyncError = result.jhLastSyncError;
        const jhGdSyncEnabled = result.jhGdSyncEnabled;
        const jhLastSync = result.jhLastSync;
        if (!jhGdSyncEnabled) {
            document.getElementById("gdStopSyncButton").style.display = 'none';
            document.getElementById("syncStatusFeedback").style.display = 'none';
            return;
        }
        document.getElementById("gdStopSyncButton").style.display = 'inline-block';
        document.getElementById("syncStatusFeedback").style.display = 'inline';
        if (jhLastSyncError != null) {
            document.getElementById("syncStatusFeedback").textContent = 'Error: ' + jhLastSyncError;
        } else {
            document.getElementById("syncStatusFeedback").textContent = "Synchronized.";
        }
        if (typeof jhLastSync !== 'undefined') {
            var cur_date = new Date();
            var seconds_passed = (cur_date.getTime() - jhLastSync) / 1000;
            var p_days = Math.floor(seconds_passed / (3600 * 24));
            seconds_passed %= (3600 * 24);
            var p_hours = Math.floor(seconds_passed / 3600);
            seconds_passed %= 3600;
            var p_minutes = Math.floor(seconds_passed / 60);
            var p_seconds = Math.floor(seconds_passed % 60);
            let passed_time_msg = '';
            if (p_days > 0)
                passed_time_msg += p_days + ' days, ';
            if (p_hours > 0 || p_days > 0)
                passed_time_msg += p_hours + ' hours, ';
            if (p_minutes > 0 || p_hours > 0 || p_days > 0)
                passed_time_msg += p_minutes + ' minutes, ';
            passed_time_msg += p_seconds + ' seconds since the last sync.';
            const syncDateLabel = document.getElementById("lastSyncDate");
            syncDateLabel.style.display = 'inline';
            syncDateLabel.textContent = passed_time_msg;
        }
    });
}


function synchronize_now() {
    chrome.runtime.onMessage.addListener((request) => {
        if (request.sync_feedback) {
            display_sync_interface();
        }
    });
    document.getElementById("syncStatusFeedback").style.display = 'inline';
    document.getElementById("syncStatusFeedback").textContent = "Synchronization started...";
    chrome.storage.local.set({ "jhGdSyncEnabled": true }, () => {
        chrome.runtime.sendMessage({ wdm_request: "gd_sync", interactive_mode: true });
    });
}


function request_permissions_and_sync() {
    chrome.permissions.request({ origins: ['https://*/*'] }, granted => {
        if (!granted)
            return;
        synchronize_now();
    });
}


function stop_synchronization() {
    chrome.storage.local.set({ "jhGdSyncEnabled": false }, display_sync_interface);
}


function process_test_warnings() {
    chrome.management.getPermissionWarningsByManifest(prompt(), console.log);
}


function process_get_dbg() {
    var storage_key = document.getElementById("getFromStorageKey").value;
    chrome.storage.local.get([storage_key], result => {
        const storage_value = result[storage_key];
        console.log('key: ' + storage_key + '; value: ' + JSON.stringify(storage_value));
    });
}


function process_set_dbg() {
    console.log('processing dbg');
    var storage_key = document.getElementById("setToStorageKey").value;
    var storage_value = document.getElementById("setToStorageVal").value;
    if (storage_value === 'undefined') {
        storage_value = undefined;
    } else {
        storage_value = JSON.parse(storage_value);
    }
    console.log("storage_key:" + storage_key + ", storage_value:" + storage_value);
    chrome.storage.local.set({ [storage_key]: storage_value }, () => {
        var last_error = chrome.runtime.lastError;
        console.log("last_error:" + last_error);
        console.log('finished setting value');
    });
}


function process_export() {
    chrome.storage.local.get(['jhUserVocabulary'], result => {
        var user_vocabulary = result.jhUserVocabulary;
        const keys = []
        for (var key in user_vocabulary) {
            if (Object.prototype.hasOwnProperty.call(user_vocabulary, key)) {
                keys.push(key);
            }
        }
        var file_content = keys.join('\r\n')
        var blob = new Blob([file_content], { type: "text/plain;charset=utf-8" });
        saveAs(blob, "my_vocabulary.txt", true);
    });
}


function process_import() {
    chrome.tabs.create({ 'url': chrome.extension.getURL('../html/import.html') })
}


function highlight_example_text(hl_params, text_id, lq_id, rq_id) {
    document.getElementById(lq_id).textContent = "";
    document.getElementById(rq_id).textContent = "";
    document.getElementById(lq_id).style = undefined;
    document.getElementById(rq_id).style = undefined;
    document.getElementById(text_id).style = make_hl_style(hl_params);
}


function show_rb_states(ids, color) {
    for (var i = 0; i < ids.length; i++) {
        const doc_element = document.getElementById(ids[i]);
        if (doc_element.label.style.backgroundColor == color) {
            doc_element.checked = true;
        }
    }
}


function process_add_dict() {
    let dictName = document.getElementById('addDictName').value;
    let dictUrl = document.getElementById('addDictUrl').value;
    dictName = dictName.trim();
    dictUrl = dictUrl.trim();
    if (!dictName || !dictUrl)
        return;
    jhOnlineDicts.push({ title: dictName, url: dictUrl });
    chrome.storage.local.set({ "jhOnlineDicts": jhOnlineDicts });
    initContextMenus(jhOnlineDicts);
    show_user_dicts();
    document.getElementById('addDictName').value = "";
    document.getElementById('addDictUrl').value = "";
}


function process_test_new_dict() {
    let dictUrl = document.getElementById('addDictUrl').value;
    dictUrl = dictUrl.trim();
    if (!dictUrl)
        return;
    const url = dictUrl + 'test';
    chrome.tabs.create({ 'url': url });
}


function process_test_old_dict(e) {
    var button = e.target;
    var btn_id = button.id;
    if (!btn_id.startsWith('testDictBtn_'))
        return;
    var btn_no = parseInt(btn_id.split('_')[1]);
    const url = jhOnlineDicts[btn_no].url + 'test';
    chrome.tabs.create({ 'url': url });
}


function process_delete_old_dict(e) {
    var button = e.target;
    var btn_id = button.id;
    if (!btn_id.startsWith('delDict'))
        return;
    var btn_no = parseInt(btn_id.split('_')[1]);
    jhOnlineDicts.splice(btn_no, 1);
    chrome.storage.local.set({ "jhOnlineDicts": jhOnlineDicts });
    initContextMenus(jhOnlineDicts);
    show_user_dicts();
}


function show_user_dicts() {
    var dicts_block = document.getElementById("existingDictsBlock");
    while (dicts_block.firstChild) {
        dicts_block.removeChild(dicts_block.firstChild);
    }
    var dictPairs = jhOnlineDicts;
    for (var i = 0; i < dictPairs.length; ++i) {
        var nameSpan = document.createElement('span');
        nameSpan.setAttribute('class', 'existingDictName');
        nameSpan.textContent = dictPairs[i].title;
        dicts_block.appendChild(nameSpan);

        var urlInput = document.createElement('input');
        urlInput.setAttribute('type', 'text');
        urlInput.setAttribute('class', 'existingDictUrl');
        urlInput.setAttribute('value', dictPairs[i].url);
        urlInput.readOnly = true;
        dicts_block.appendChild(urlInput);

        var testButton = document.createElement('button');
        testButton.setAttribute('class', 'shortButton');
        testButton.id = 'testDictBtn_' + i;
        testButton.textContent = 'Test';
        testButton.addEventListener("click", process_test_old_dict);
        dicts_block.appendChild(testButton);

        var deleteButton = document.createElement('button');
        deleteButton.setAttribute('class', 'imgButton');
        deleteButton.id = 'delDictBtn_' + i;
        var img = document.createElement("img");
        img.setAttribute("src", "../images/delete.png");
        img.id = 'delDictImg_' + i;
        deleteButton.appendChild(img);
        deleteButton.addEventListener("click", process_delete_old_dict);
        dicts_block.appendChild(deleteButton);

        dicts_block.appendChild(document.createElement("br"));
    }
}


function show_internal_state() {
    var word_hl_params = jhHlSettings.wordParams;
    // var idiom_hl_params = jhHlSettings.idiomParams;


    document.getElementById("wordsEnabled").checked = word_hl_params.enabled;
    // document.getElementById("idiomsEnabled").checked = idiom_hl_params.enabled;
    document.getElementById("wordsBlock").style.display = word_hl_params.enabled ? "block" : "none";
    // document.getElementById("idiomsBlock").style.display = idiom_hl_params.enabled ? "block" : "none";

    document.getElementById("wordsBold").checked = word_hl_params.bold;
    // document.getElementById("idiomsBold").checked = idiom_hl_params.bold;

    document.getElementById("wordsBackground").checked = word_hl_params.useBackground;
    // document.getElementById("idiomsBackground").checked = idiom_hl_params.useBackground;

    document.getElementById("wordsColor").checked = word_hl_params.useColor;
    // document.getElementById("idiomsColor").checked = idiom_hl_params.useColor;

    document.getElementById("pronunciationEnabled").checked = jhEnableTTS;

    document.getElementById("wcRadioBlock").style.display = word_hl_params.useColor ? "block" : "none";
    show_rb_states(wc_rb_ids, word_hl_params.color);
    // document.getElementById("icRadioBlock").style.display = idiom_hl_params.useColor ? "block" : "none";
    // show_rb_states(ic_rb_ids, idiom_hl_params.color);
    document.getElementById("wbRadioBlock").style.display = word_hl_params.useBackground ? "block" : "none";
    show_rb_states(wb_rb_ids, word_hl_params.backgroundColor);
    // document.getElementById("ibRadioBlock").style.display = idiom_hl_params.useBackground ? "block" : "none";
    // show_rb_states(ib_rb_ids, idiom_hl_params.backgroundColor);

    for (var t = 0; t < target_types.length; t++) {
        const ttype = target_types[t];
        for (var i = 0; i < hover_popup_types.length; i++) {
            const is_hit = (hover_popup_types[i] == jhHoverSettings[ttype + "_hover"])
            document.getElementById(ttype + "b_" + hover_popup_types[i]).checked = is_hit;
        }
    }

    highlight_example_text(word_hl_params, "wordHlText", "wql", "wqr");
    // highlight_example_text(idiom_hl_params, "idiomHlText", "iql", "iqr");
    show_user_dicts();
}


function add_cb_event_listener(id, dst_params, dst_key) {
    document.getElementById(id).addEventListener("click", () => {
        const checkboxElem = document.getElementById(id);
        if (checkboxElem.checked) {
            dst_params[dst_key] = true;
        } else {
            dst_params[dst_key] = false;
        }
        show_internal_state();
    });
}


function process_rb(dst_params, dst_key, ids) {
    for (var i = 0; i < ids.length; i++) {
        const doc_element = document.getElementById(ids[i]);
        if (doc_element.checked) {
            dst_params[dst_key] = doc_element.label.style.backgroundColor;
        }
    }
    show_internal_state();
}


function handle_rb_loop(ids, dst_params, dst_key) {
    for (var i = 0; i < ids.length; i++) {
        document.getElementById(ids[i]).addEventListener("click", () => {
            process_rb(dst_params, dst_key, ids);
        });
    }
}


function assign_back_labels() {
    var labels = document.getElementsByTagName('LABEL');
    for (var i = 0; i < labels.length; i++) {
        if (labels[i].htmlFor != '') {
            var elem = document.getElementById(labels[i].htmlFor);
            if (elem)
                elem.label = labels[i];
        }
    }
}


function hover_rb_handler() {
    for (var t = 0; t < target_types.length; t++) {
        const ttype = target_types[t];
        for (var i = 0; i < hover_popup_types.length; i++) {
            const element_id = ttype + "b_" + hover_popup_types[i];
            const param_key = ttype + "_hover";
            const rbElem = document.getElementById(element_id);
            if (rbElem.checked) {
                jhHoverSettings[param_key] = hover_popup_types[i];
            }
        }
    }
    chrome.storage.local.set({ 'jhHoverSettings': jhHoverSettings });
}


function add_hover_rb_listeners() {
    for (var t = 0; t < target_types.length; t++) {
        for (var i = 0; i < hover_popup_types.length; i++) {
            const element_id = target_types[t] + "b_" + hover_popup_types[i];
            document.getElementById(element_id).addEventListener("click", hover_rb_handler);
        }
    }
}


function process_display() {
    window.onload = () => {
        chrome.storage.local.get(["jhHlSettings", "jhHoverSettings", "jhOnlineDicts", "wd_developer_mode", "jhEnableTTS"], result => {
            assign_back_labels();
            jhHlSettings = result.jhHlSettings;
            jhHoverSettings = result.jhHoverSettings;
            jhOnlineDicts = result.jhOnlineDicts;
            jhEnableTTS = result.jhEnableTTS ? true : false;

            var wd_developer_mode = result.wd_developer_mode;

            //TODO fix this monstrosity using this wrapper-function hack: 
            //http://stackoverflow.com/questions/7053965/when-using-callbacks-inside-a-loop-in-javascript-is-there-any-way-to-save-a-var
            handle_rb_loop(wc_rb_ids, jhHlSettings.wordParams, "color");
            // handle_rb_loop(ic_rb_ids, jhHlSettings.idiomParams, "color");
            handle_rb_loop(wb_rb_ids, jhHlSettings.wordParams, "backgroundColor");
            // handle_rb_loop(ib_rb_ids, jhHlSettings.idiomParams, "backgroundColor");

            add_cb_event_listener("wordsEnabled", jhHlSettings.wordParams, "enabled");
            // add_cb_event_listener("idiomsEnabled", jhHlSettings.idiomParams, "enabled");
            add_cb_event_listener("wordsBold", jhHlSettings.wordParams, "bold");
            // add_cb_event_listener("idiomsBold", jhHlSettings.idiomParams, "bold");
            add_cb_event_listener("wordsBackground", jhHlSettings.wordParams, "useBackground");
            // add_cb_event_listener("idiomsBackground", jhHlSettings.idiomParams, "useBackground");
            add_cb_event_listener("wordsColor", jhHlSettings.wordParams, "useColor");
            // add_cb_event_listener("idiomsColor", jhHlSettings.idiomParams, "useColor");

            add_hover_rb_listeners();

            if (wd_developer_mode) {
                document.getElementById("debugControl").style.display = 'block';
            }

            document.getElementById("gdSyncButton").addEventListener("click", request_permissions_and_sync);
            document.getElementById("gdStopSyncButton").addEventListener("click", stop_synchronization);

            document.getElementById("saveVocab").addEventListener("click", process_export);
            document.getElementById("loadVocab").addEventListener("click", process_import);

            document.getElementById("getFromStorageBtn").addEventListener("click", process_get_dbg);
            document.getElementById("setToStorageBtn").addEventListener("click", process_set_dbg);

            document.getElementById("testManifestWarningsBtn").addEventListener("click", process_test_warnings);

            document.getElementById("addDict").addEventListener("click", process_add_dict);
            document.getElementById("testNewDict").addEventListener("click", process_test_new_dict);

            document.getElementById("moreInfoLink").href = chrome.extension.getURL('../html/sync_help.html');

            document.getElementById("saveVisuals").addEventListener("click", () => {
                chrome.storage.local.set({ 'jhHlSettings': jhHlSettings });
            });

            document.getElementById("defaultDicts").addEventListener("click", () => {
                jhOnlineDicts = make_default_online_dicts();
                chrome.storage.local.set({ "jhOnlineDicts": jhOnlineDicts });
                initContextMenus(jhOnlineDicts);
                show_user_dicts();
            });

            document.getElementById("pronunciationEnabled").addEventListener("click", e => {
                jhEnableTTS = e.target.checked;
                chrome.storage.local.set({ "jhEnableTTS": jhEnableTTS });
            });

            display_sync_interface();
            show_internal_state();
        });

    }
}


document.addEventListener("DOMContentLoaded", () => {
    localizeHtmlPage();
    process_display();
});
